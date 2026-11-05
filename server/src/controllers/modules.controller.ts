import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import type { AppError } from '../middleware/errorHandler.js';
import {
  moduleContentSchema,
  moduleSchema,
  reorderModuleContentsSchema,
  reorderModulesSchema,
  updateModuleContentSchema,
} from '../utils/validation.js';
import { deleteFromCloudinary } from '../utils/upload.js';
import { deleteScoresOf } from '../utils/manualScoring.js';
import {
  assertCanManageCourse,
  assertCanManageModule,
  assertEnrolledIfStudent,
  assertHttpUrl,
  httpError,
  parseUuid,
} from '../utils/access.js';

export async function listModules(req: Request, res: Response): Promise<void> {
  const { course_id } = req.params as { course_id: string };
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertEnrolledIfStudent(req.user, parseUuid(course_id, 'course id'));

  const modules = await sql`
    SELECT m.id, m.course_id, m.title, m.rich_description, m.video_url,
           m.attachment_url, m.order_index, m.created_at
    FROM modules m
    WHERE m.course_id = ${course_id}
    ORDER BY m.order_index ASC
  `;
  res.json({ modules });
}

export async function getModule(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  const [module] = await sql`
    SELECT m.id, m.course_id, m.title, m.rich_description, m.video_url,
           m.attachment_url, m.order_index, m.created_at
    FROM modules m
    WHERE m.id = ${id}
  `;
  if (!module) {
    const err = new Error('Module not found') as AppError;
    err.statusCode = 404;
    throw err;
  }
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertEnrolledIfStudent(req.user, module.course_id as string, 'Module not found');
  res.json({ module });
}

export async function createModule(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // The validation middleware does not replace req.body, so parse again to apply defaults.
  const input = moduleSchema.parse(req.body);
  assertHttpUrl(input.video_url, 'Video link');
  assertHttpUrl(input.attachment_url, 'Attachment link');

  await assertCanManageCourse(req.user, input.course_id);

  const [module] = await sql`
    INSERT INTO modules (course_id, title, rich_description, video_url, attachment_url, order_index)
    VALUES (${input.course_id}, ${input.title}, ${input.rich_description || null},
            ${input.video_url || null}, ${input.attachment_url || null}, ${input.order_index})
    RETURNING id, course_id, title, rich_description, video_url, attachment_url, order_index, created_at
  `;
  res.status(201).json({ module });
}

export async function updateModule(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const id = parseUuid(req.params.id, 'module id');
  const input = moduleSchema.omit({ course_id: true }).partial().parse(req.body);
  assertHttpUrl(input.video_url, 'Video link');
  assertHttpUrl(input.attachment_url, 'Attachment link');

  await assertCanManageModule(req.user, id);

  // Optional text fields: undefined = leave unchanged, '' = clear.
  const descProvided = input.rich_description !== undefined;
  const videoProvided = input.video_url !== undefined;
  const attachmentProvided = input.attachment_url !== undefined;

  const [module] = await sql`
    UPDATE modules
    SET title = COALESCE(${input.title ?? null}, title),
        rich_description = CASE WHEN ${descProvided}::boolean THEN ${input.rich_description || null} ELSE rich_description END,
        video_url = CASE WHEN ${videoProvided}::boolean THEN ${input.video_url || null} ELSE video_url END,
        attachment_url = CASE WHEN ${attachmentProvided}::boolean THEN ${input.attachment_url || null} ELSE attachment_url END,
        order_index = COALESCE(${input.order_index ?? null}, order_index)
    WHERE id = ${id}
    RETURNING id, course_id, title, rich_description, video_url, attachment_url, order_index
  `;
  res.json({ module });
}

export async function deleteModule(req: Request, res: Response): Promise<void> {
  const id = parseUuid(req.params.id, 'module id');
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanManageModule(req.user, id);

  // Clean up Cloudinary assets before the cascade deletes the content rows.
  const assets = await sql`
    SELECT cloudinary_public_id, resource_type FROM module_contents
    WHERE module_id = ${id} AND cloudinary_public_id IS NOT NULL
  `;
  for (const asset of assets) {
    if (asset.cloudinary_public_id) {
      await deleteFromCloudinary(
        asset.cloudinary_public_id as string,
        (asset.resource_type ?? 'raw') as 'image' | 'video' | 'raw',
      );
    }
  }

  // Cascade delete submissions for assignments in this module, then the assignments,
  // then the module itself (module_contents rows go with ON DELETE CASCADE).
  await sql`DELETE FROM submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE module_id = ${id})`;
  // Scores typed in for in-person assignments of this module go with them (online work keeps its grades).
  const inPerson = await sql`SELECT id FROM assignments WHERE module_id = ${id} AND delivery = 'in_person'`;
  await deleteScoresOf('assignment', inPerson.map((row) => row.id as string));
  await sql`DELETE FROM assignments WHERE module_id = ${id}`;
  const [module] = await sql`DELETE FROM modules WHERE id = ${id} RETURNING id`;
  if (!module) throw httpError(404, 'Module not found');
  res.json({ message: 'Module deleted' });
}

// ---------------------------------------------------------------------------
// Module content blocks
// ---------------------------------------------------------------------------

export async function listModuleContents(req: Request, res: Response): Promise<void> {
  const { module_id } = req.params as { module_id: string };
  parseUuid(module_id, 'module id');

  const [module] = await sql`SELECT id, course_id FROM modules WHERE id = ${module_id}`;
  if (!module) throw httpError(404, 'Module not found');
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertEnrolledIfStudent(req.user, module.course_id as string, 'Module not found');

  const contents = await sql`
    SELECT id, module_id, type, title, content, url, cloudinary_public_id, resource_type,
           order_index, created_at
    FROM module_contents
    WHERE module_id = ${module_id}
    ORDER BY order_index ASC, created_at ASC
  `;
  res.json({ contents });
}

export async function createModuleContent(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const input = moduleContentSchema.parse(req.body);
  assertHttpUrl(input.url, 'Link');

  await assertCanManageModule(req.user, input.module_id);

  const [content] = await sql`
    INSERT INTO module_contents
      (module_id, type, title, content, url, cloudinary_public_id, resource_type, order_index)
    VALUES
      (${input.module_id}, ${input.type}, ${input.title ?? null}, ${input.content ?? null},
       ${input.url ?? null}, ${input.cloudinary_public_id ?? null}, ${input.resource_type ?? null},
       ${input.order_index})
    RETURNING id, module_id, type, title, content, url, cloudinary_public_id, resource_type,
              order_index, created_at
  `;
  res.status(201).json({ content });
}

export async function updateModuleContent(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const id = parseUuid(req.params.id, 'content id');
  const input = updateModuleContentSchema.parse(req.body);
  assertHttpUrl(input.url, 'Link');

  const [existing] = await sql`
    SELECT module_id, cloudinary_public_id, resource_type FROM module_contents WHERE id = ${id}
  `;
  if (!existing) throw httpError(404, 'Content not found');
  await assertCanManageModule(req.user, existing.module_id as string);

  // Optional text fields: undefined = leave unchanged, '' = clear.
  const titleProvided = input.title !== undefined;
  const contentProvided = input.content !== undefined;
  const urlProvided = input.url !== undefined;
  const typeProvided = input.type !== undefined;
  const publicIdProvided = input.cloudinary_public_id !== undefined;
  const resourceTypeProvided = input.resource_type !== undefined;

  const [content] = await sql`
    UPDATE module_contents
    SET type = CASE WHEN ${typeProvided}::boolean THEN ${input.type} ELSE type END,
        title = CASE WHEN ${titleProvided}::boolean THEN ${input.title ?? null} ELSE title END,
        content = CASE WHEN ${contentProvided}::boolean THEN ${input.content ?? null} ELSE content END,
        url = CASE WHEN ${urlProvided}::boolean THEN ${input.url ?? null} ELSE url END,
        cloudinary_public_id = CASE WHEN ${publicIdProvided}::boolean THEN ${input.cloudinary_public_id ?? null} ELSE cloudinary_public_id END,
        resource_type = CASE WHEN ${resourceTypeProvided}::boolean THEN ${input.resource_type ?? null} ELSE resource_type END,
        order_index = COALESCE(${input.order_index ?? null}, order_index)
    WHERE id = ${id}
    RETURNING id, module_id, type, title, content, url, cloudinary_public_id, resource_type,
              order_index, created_at
  `;

  // The file was replaced or cleared: drop the old Cloudinary asset only after the row is saved.
  const oldPublicId = existing.cloudinary_public_id as string | null;
  if (oldPublicId && publicIdProvided && (input.cloudinary_public_id ?? null) !== oldPublicId) {
    await deleteFromCloudinary(
      oldPublicId,
      (existing.resource_type ?? 'raw') as 'image' | 'video' | 'raw',
    );
  }
  res.json({ content });
}

export async function deleteModuleContent(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const id = parseUuid(req.params.id, 'content id');

  const [existing] = await sql`
    SELECT module_id, cloudinary_public_id, resource_type FROM module_contents WHERE id = ${id}
  `;
  if (!existing) throw httpError(404, 'Content not found');
  await assertCanManageModule(req.user, existing.module_id as string);

  // Delete the row first: if this fails nothing is lost, and the Cloudinary cleanup is best-effort.
  await sql`DELETE FROM module_contents WHERE id = ${id}`;
  if (existing.cloudinary_public_id) {
    await deleteFromCloudinary(
      existing.cloudinary_public_id as string,
      (existing.resource_type ?? 'raw') as 'image' | 'video' | 'raw',
    );
  }
  res.json({ message: 'Content deleted' });
}

/**
 * Sets the order of a course's modules in one transaction. The client sends the full list of
 * module ids in display order and the server renumbers them 0..n-1, so duplicate or gapped
 * positions in old data are repaired as a side effect.
 */
export async function reorderModules(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const courseId = parseUuid(req.params.course_id, 'course id');
  const input = reorderModulesSchema.parse(req.body);

  await assertCanManageCourse(req.user, courseId);

  const ids = input.module_ids;
  if (new Set(ids).size !== ids.length) throw httpError(400, 'Duplicate module ids');

  const owned = await sql`SELECT id FROM modules WHERE course_id = ${courseId}`;
  const ownedIds = new Set(owned.map((row) => row.id as string));
  if (ids.length !== ownedIds.size || !ids.every((id) => ownedIds.has(id))) {
    throw httpError(409, 'This course’s modules changed. Refresh the page and try again.');
  }

  if (ids.length === 0) {
    res.json({ message: 'Nothing to reorder' });
    return;
  }

  const statements = ids.map(
    (id, index) =>
      sql`UPDATE modules SET order_index = ${index} WHERE id = ${id} AND course_id = ${courseId}`,
  );
  await sql.transaction(statements);
  res.json({ message: 'Reordered' });
}

export async function reorderModuleContents(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const input = reorderModuleContentsSchema.parse(req.body);

  if (input.contents.length === 0) {
    res.json({ message: 'Nothing to reorder' });
    return;
  }

  const ids = input.contents.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw httpError(400, 'Duplicate content ids');

  // Authorise against the module of the first block, then require every block to belong to it.
  const [first] = await sql`SELECT module_id FROM module_contents WHERE id = ${ids[0]}`;
  if (!first) throw httpError(404, 'Content not found');
  const moduleId = first.module_id as string;
  await assertCanManageModule(req.user, moduleId);

  const owned = await sql`SELECT id FROM module_contents WHERE module_id = ${moduleId}`;
  const ownedIds = new Set(owned.map((row) => row.id as string));
  if (!ids.every((id) => ownedIds.has(id))) {
    throw httpError(400, 'All content blocks must belong to the same module');
  }

  const statements = input.contents.map(
    (item) =>
      sql`UPDATE module_contents SET order_index = ${item.order_index} WHERE id = ${item.id} AND module_id = ${moduleId}`,
  );
  await sql.transaction(statements);
  res.json({ message: 'Reordered' });
}
