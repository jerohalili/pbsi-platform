import { Router } from 'express';
import {
  createMentions,
  listMentions,
  acknowledgeMention,
  updateMention,
  deleteMention,
} from '../controllers/mentions.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createMentionSchema, updateMentionSchema } from '../utils/validation.js';

const router = Router();

router.use(verifyToken);

// GET /api/mentions?item_type=&item_id=  (managers: every note on the item; students: only their own)
router.get('/', asyncHandler(listMentions));
router.post('/', restrictTo('admin', 'teacher'), validate(createMentionSchema), asyncHandler(createMentions));
router.post('/:id/acknowledge', restrictTo('student'), asyncHandler(acknowledgeMention));
router.patch('/:id', restrictTo('admin', 'teacher'), validate(updateMentionSchema), asyncHandler(updateMention));
router.delete('/:id', restrictTo('admin', 'teacher'), asyncHandler(deleteMention));

export default router;
