import type { DriveStep } from 'driver.js';
import type { TourBuilder } from './types.ts';
import { present, tip } from './shell.ts';

/** /discussions */
export const discussionsTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('dc-header', 'Discussions', 'Ask questions, share ideas and help each other learn. Each course has its own discussions.'),
    tip('dc-course', 'Pick a course', 'Switch course here to see that course\u2019s discussions.'),
    tip('dc-new', 'New discussion', 'Start a discussion in the selected course. Add a clear title so others can find it.'),
  ];
  if (present('dc-thread')) {
    steps.push(
      tip(
        'dc-thread',
        'A discussion',
        'Badges show its state: Pinned stays at the top, Answered means a reply was marked as the answer, and Locked means no new replies. The number is how many replies it has. Press Open to read it.',
        'top',
      ),
    );
  } else if (present('dc-empty')) {
    steps.push(tip('dc-empty', 'Nothing here yet', 'Be the first to start a discussion with \u201cNew discussion\u201d.', 'top'));
  }
  return steps;
};

/** /discussions/:id */
export const discussionThreadTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('dt-post', 'The post', 'The original question or idea, with its course, author and badges (Pinned, Answered, Locked).'),
  ];
  if (present('dt-moderate')) {
    steps.push(
      tip('dt-moderate', 'Pin and lock', 'Pin keeps the discussion at the top of the list. Lock turns off new replies from students.', 'left'),
    );
  }
  if (present('dt-edit')) {
    steps.push(tip('dt-edit', 'Your post', 'You can edit or delete your own post here. Editing is turned off while a discussion is locked, unless you are a teacher or admin.', 'left'));
  } else if (present('dt-report')) {
    steps.push(tip('dt-report', 'Report', 'See something inappropriate? Report sends it to the moderators.', 'left'));
  }
  steps.push(
    tip('dt-replies', 'Replies', 'Everyone\u2019s replies appear here. The answer, if one was chosen, has a green border and an Answer badge.', 'top'),
  );
  if (present('dt-reply-actions')) {
    steps.push(
      tip(
        'dt-reply-actions',
        'Reply buttons',
        'Reply answers a specific person. The post\u2019s author or a moderator can mark the best reply as the answer. You can edit or delete your own replies, and report someone else\u2019s.',
        'top',
      ),
    );
  }
  if (present('dt-reply-form')) {
    steps.push(tip('dt-reply-form', 'Write a reply', 'Type your reply and press Post reply. The counter shows how many characters you have left.', 'top'));
  } else if (present('dt-locked')) {
    steps.push(tip('dt-locked', 'Locked', 'This discussion is locked, so new replies are turned off.', 'top'));
  }
  return steps;
};

/** /notifications */
export const notificationsTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('nt-header', 'Notifications', 'Everything that needs your attention, such as grades, announcements, replies and mentions.'),
    tip('nt-mark-all', 'Mark all as read', 'Clears every unread notification at once. It is turned off when nothing is unread.', 'left'),
    tip('nt-filter', 'All or unread', 'Switch between every notification and only the unread ones. The number is how many are unread.'),
  ];
  if (present('nt-list')) {
    steps.push(
      tip(
        'nt-list',
        'Your notifications',
        'Unread ones have a tinted background and a dot. Click one to open what it is about; it is marked as read.',
        'top',
      ),
    );
    if (present('nt-remove')) {
      steps.push(tip('nt-remove', 'Remove', 'The bin removes a notification from your list.', 'left'));
    }
  } else if (present('nt-empty')) {
    steps.push(tip('nt-empty', 'All caught up', 'New notifications will appear here as things happen.', 'top'));
  }
  return steps;
};

/** /settings */
export const settingsTour: TourBuilder = () => [
  tip('st-header', 'Settings', 'Manage your profile picture, personal details and password.'),
  tip('st-avatar', 'Profile picture', 'Choose a picture (square ones work best) and press Save picture. Remove picture deletes it.'),
  tip('st-profile', 'Personal details', 'Edit your name, phone, date of birth and address. Your email is shown for reference: it is what you sign in with, so ask an administrator if it needs to change.'),
  tip('st-password', 'Password', 'Use at least 8 characters. For your safety, changing it signs you out everywhere.', 'top'),
];
