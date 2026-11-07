import { Router } from 'express';
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/announcements.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { announcementPostLimiter } from '../middleware/announcementLimiter.js';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../utils/validation.js';

const router = Router();

router.use(verifyToken);

// GET /api/announcements            what is live for me (dashboards, banner)
// GET /api/announcements?history=true   admin: all; teacher: their own, including expired ones
router.get('/', asyncHandler(listAnnouncements));
router.post(
  '/',
  restrictTo('admin', 'teacher'),
  announcementPostLimiter,
  validate(createAnnouncementSchema),
  asyncHandler(createAnnouncement),
);
router.patch('/:id', restrictTo('admin', 'teacher'), validate(updateAnnouncementSchema), asyncHandler(updateAnnouncement));
router.delete('/:id', restrictTo('admin', 'teacher'), asyncHandler(deleteAnnouncement));

export default router;
