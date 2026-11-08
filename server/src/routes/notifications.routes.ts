import { Router } from 'express';
import {
  listNotifications,
  getUnreadCount,
  getUnreadByCourse,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  createNotification,
} from '../controllers/notifications.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { notificationSchema } from '../utils/validation.js';

const router = Router();

router.use(verifyToken);

router.get('/', asyncHandler(listNotifications));
// Fixed paths first, so "read-all" and "unread-count" are never read as an :id.
router.get('/unread-count', asyncHandler(getUnreadCount));
router.get('/unread-by-course', asyncHandler(getUnreadByCourse));
router.patch('/read-all', asyncHandler(markAllNotificationsRead));
router.patch('/:id/read', asyncHandler(markNotificationRead));
router.delete('/:id', asyncHandler(deleteNotification));
router.post(
  '/',
  restrictTo('admin', 'teacher'),
  validate(notificationSchema),
  asyncHandler(createNotification),
);

export default router;
