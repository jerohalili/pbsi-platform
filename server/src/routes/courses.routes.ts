import { Router } from 'express';
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
} from '../controllers/courses.controller.js';
import {
  listEnrollments,
  addEnrollments,
  removeEnrollment,
} from '../controllers/enrollments.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { courseSchema, enrollStudentsSchema } from '../utils/validation.js';

const router = Router();

router.use(verifyToken);

router.get('/', asyncHandler(listCourses));
router.get('/:id', asyncHandler(getCourse));
router.post(
  '/',
  restrictTo('admin', 'teacher'),
  validate(courseSchema),
  asyncHandler(createCourse),
);
router.patch(
  '/:id',
  restrictTo('admin', 'teacher'),
  validate(courseSchema.partial()),
  asyncHandler(updateCourse),
);
router.delete('/:id', restrictTo('admin', 'teacher'), asyncHandler(deleteCourse));

// Who is in the course (its teacher or an admin). Students never see these.
router.get('/:course_id/enrollments', restrictTo('admin', 'teacher'), asyncHandler(listEnrollments));
router.post(
  '/:course_id/enrollments',
  restrictTo('admin', 'teacher'),
  validate(enrollStudentsSchema),
  asyncHandler(addEnrollments),
);
router.delete(
  '/:course_id/enrollments/:student_id',
  restrictTo('admin', 'teacher'),
  asyncHandler(removeEnrollment),
);

export default router;
