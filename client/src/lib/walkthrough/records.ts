import type { DriveStep } from 'driver.js';
import type { TourBuilder } from './types.ts';
import { present, tip } from './shell.ts';
import { PASSING_GRADE } from '@/lib/grades.ts';

/** /attendance */
export const attendanceTour: TourBuilder = ({ role }) => {
  const student = role === 'student';
  const steps: DriveStep[] = [
    tip(
      'att-header',
      'Attendance',
      student ? 'Your attendance across all of your courses.' : 'Take attendance for a class and review past records.',
    ),
  ];
  if (present('att-summary')) {
    steps.push(
      tip(
        'att-summary',
        'Your totals',
        'How many days you were present, absent, late or excused. The percentage is present \u00f7 (present + absent + late): excused days are not counted, and a late day does not count as present.',
      ),
    );
  }
  if (present('att-tabs')) {
    steps.push(
      tip('att-tabs', 'Two sections', '\u201cTake attendance\u201d records a class. \u201cRecords\u201d lets you review earlier days.'),
    );
  }
  if (present('att-pick')) {
    steps.push(
      tip('att-pick', 'Pick the class', 'Choose the course and the day (future dates are not allowed), or search for a student by name or number.'),
      tip('att-counts', 'Live count', 'A running count for each status. \u201cNot marked\u201d shows who is still left.'),
    );
    if (present('att-status')) {
      steps.push(tip('att-status', 'Mark each student', 'Press Present, Absent, Late or Excused for each student.', 'top'));
    }
    steps.push(
      tip(
        'att-actions',
        'Fill in and save',
        '\u201cMark unmarked as present\u201d fills in everyone you have not marked yet. Nothing is stored until you press Save changes.',
        'left',
      ),
    );
  }
  if (present('att-filters')) {
    steps.push(
      tip('att-filters', 'Filters', 'Filter by course or by one date. \u201cClear date\u201d shows every day again.'),
      tip('att-records', 'Records', 'Each row is one day in one course with its status. Up to the 500 most recent records are listed.', 'top'),
    );
  }
  return steps;
};

/** /timetable */
export const timetableTour: TourBuilder = ({ role, isMobile }) => {
  const editor = role !== 'student';
  const steps: DriveStep[] = [
    tip(
      'tt-header',
      'Weekly timetable',
      role === 'teacher'
        ? 'Your classes by day and period. You can add or change the ones for courses you teach.'
        : role === 'admin'
          ? 'The class schedule by day and period. You can add, move or remove classes for any course.'
          : 'The class schedule by day and period.',
    ),
  ];
  if (present('tt-scope')) {
    steps.push(tip('tt-scope', 'Whose classes?', '\u201cMy classes\u201d shows only yours. \u201cWhole school\u201d shows every class.'));
  }
  if (present('tt-add')) {
    steps.push(
      tip('tt-add', 'Add class', 'Opens a form for the course, day, period, start and end times, and room.'),
    );
  }
  if (isMobile) {
    steps.push(
      tip(
        'tt-days',
        'Your week',
        editor
          ? 'One card per day, with today highlighted. Each class shows its period, time and room. Use the + on a day to add a class, and Edit or Remove on classes you manage.'
          : 'One card per day, with today highlighted. Each class shows its period, time and room.',
        'top',
      ),
    );
  } else {
    steps.push(
      tip(
        'tt-grid',
        'The grid',
        editor
          ? 'Days run across and periods run down, with today\u2019s column highlighted. Each block shows the course, teacher, room and time. Hover an empty cell and press + to add a class there; Edit and Remove appear on classes you manage.'
          : 'Days run across and periods run down, with today\u2019s column highlighted. Each block shows the course, teacher, room and time.',
        'top',
      ),
    );
  }
  return steps;
};

/** /grades */
export const gradesTour: TourBuilder = ({ role }) => {
  const manager = role !== 'student';
  const steps: DriveStep[] = [
    tip(
      'gr-header',
      'Grades',
      role === 'admin'
        ? 'Grades recorded across all courses. You can adjust any of them.'
        : role === 'teacher'
          ? 'Grades recorded in the courses you teach. You can adjust any of them.'
          : 'Your grades, course by course. Every assignment and quiz counts equally toward your average.',
    ),
    tip('gr-export', 'Export CSV', 'Downloads the rows currently shown, after your filters, as a CSV file you can open in Excel or Google Sheets.', 'left'),
  ];
  if (present('gr-stats')) {
    steps.push(
      tip(
        'gr-stats',
        'Headline numbers',
        manager
          ? `Class average, students graded, graded items, and At risk: students whose course average is below the ${PASSING_GRADE}% passing mark.`
          : `Your average, graded items, how many courses you are passing (average of ${PASSING_GRADE}% or higher) and your best course.`,
      ),
    );
  }
  if (present('gr-courses')) {
    steps.push(tip('gr-courses', 'By course', 'One card per course with its average. Click a card to filter the table below to that course.'));
  }
  if (present('gr-filters')) {
    steps.push(
      tip(
        'gr-filters',
        'Find a grade',
        manager
          ? 'Search by student, course or assessment, then filter by course, school year and type, or change the sort. \u201cShowing X of Y\u201d tells you how many rows match.'
          : 'Search by course or assessment, then filter by course, school year and type, or change the sort. \u201cShowing X of Y\u201d tells you how many rows match.',
      ),
    );
  }
  if (present('gr-table')) {
    steps.push(
      tip(
        'gr-table',
        'The grade list',
        manager
          ? 'One row per graded item: student, course, assessment, type, score and date.'
          : 'One row per graded item: course, assessment, type, score and date.',
        'top',
      ),
    );
  }
  if (manager && present('gr-adjust')) {
    steps.push(
      tip(
        'gr-adjust',
        'Adjust a grade',
        'Changes only the recorded grade (and lets you add a note to the student). The submission or quiz attempt stays as it was, and grading the assignment again replaces your adjustment.',
        'left',
      ),
    );
  }
  return steps;
};
