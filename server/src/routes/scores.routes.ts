import { Router } from 'express';
import { getScoreSheet, saveScores } from '../controllers/scores.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { saveScoresSchema } from '../utils/validation.js';

const router = Router();

router.use(verifyToken);

// Score sheet of an exam or an in-person assignment / quiz: the course's teacher or an admin.
// :item_type is assignment | quiz | exam
router.get('/:item_type/:id', restrictTo('admin', 'teacher'), asyncHandler(getScoreSheet));
router.put('/:item_type/:id', restrictTo('admin', 'teacher'), validate(saveScoresSchema), asyncHandler(saveScores));

export default router;
