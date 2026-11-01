# PBSI Platform

A zero-cost school management system built with the PERN stack (PostgreSQL, Express, React, Node). Administrators, teachers and students each get their own role-based dashboard for courses, modules, assignments, auto-graded quizzes, grades, attendance, timetables, discussions and notifications.

Live app: [https://pbsi-platform.vercel.app](https://pbsi-platform.vercel.app)

## Roles

There are three roles. Accounts are created by staff; public sign-up is disabled (`POST /api/auth/register` returns 403).

| Role        | What they can do                                                                                                                                                                                                                                        |
|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **admin**   | Everything: manage all users, courses, grades, attendance, timetable and audit logs; export students to CSV                                                                                                                                             |
| **teacher** | Manage their own courses, modules, assignments, quizzes and timetable entries; choose which students are enrolled in their courses; grade submissions; take attendance; view and adjust grades for the courses they teach; create student accounts and delete the students they added (only while the student has no records) |
| **student** | View the courses they are enrolled in, their own grades and attendance; submit assignments; take published quizzes; join discussions                                                                                                                                             |

## Features

- **Users and RBAC**: `verifyToken` + `restrictTo(...roles)` middleware, plus ownership checks (a teacher only manages the courses they teach, a student only sees their own records). Admins can create, edit, deactivate/reactivate, reset passwords for and delete users. Deleting an account: an admin can delete any account (except their own and the last active admin), and a teacher only the students they added (`users.created_by`). A teacher cannot delete a student who has grades, attendance, submissions, quiz attempts or discussion posts; an admin can, after a warning that shows what will be deleted along with the account. Audit entries, courses and records someone else recorded or graded always block deletion (deactivate instead).
- **Session revocation**: deactivating an account or resetting its password ends that person's sessions immediately (`users.tokens_valid_after`, checked on every request and on token refresh).
- **Settings** (`/settings`, everyone): change your profile picture, name, phone, date of birth and address, and your password. Email and role stay administrator-managed. Changing the password ends every session, this one included, the same way an admin reset does.
- **Courses and modules**, with teacher assignment. A module has a title, a rich-text description, an optional video link and an optional file attachment (see *File uploads*).
- **Course enrollment**: a course's teacher (or an admin) chooses which students are enrolled, from the *Students* section of the course page (`enrollments` table). A student sees only the courses they are enrolled in: the course, its modules and lessons, assignments, quizzes, discussions and timetable entries, and can only hand in work or take quizzes there. Teachers take attendance for the enrolled students only (a student removed after being marked stays on that day's list, so the day can still be corrected). Removing a student keeps their grades, submissions, quiz attempts and attendance. New student accounts start with no courses. Adding and removing is audited (`enrollment.add`, `enrollment.remove`) and the student is notified.
- **Assignments and submissions**: assignments start as drafts and are invisible to students (and not announced) until the teacher presses Publish, exactly like quizzes. Once a student has handed in work the assignment can no longer be unpublished. Students hand in a file (stored privately in Cloudinary) or a link; teachers attach one private material file and/or a link, and grade with feedback. Files are only reachable through short-lived signed links, issued after an access check.
- **Quizzes**: teachers build quizzes and questions; student attempts are graded automatically. Questions are frozen once a student has taken the quiz. A question can carry an optional picture (frozen with the question).
- **Grades**: written automatically when an assignment is graded or a quiz is submitted. Scores are percentages (0-100). A teacher (own courses) or an admin can adjust a grade; the change is audited and the student is notified. A student's average is calculated live from the `grades` table. The Grades page shows per-course cards, DepEd descriptors (75% passes), filters, sorting and CSV export.
- **Grade terms**: `grades.term` is the school year label (June starts a new year, Manila time), e.g. `2026` covers June 2026 to May 2027.
- **Attendance**: teachers and admins load a class roster for a course and date and save it in bulk or one student at a time. There is one record per student, course and day; saving again updates it. Changing an already-recorded status is treated as a correction and audited (`attendance.override`). Students see their own records and a summary.
- **Timetable**: weekly schedule, Monday to Saturday, by period. The API refuses an entry that would double-book a teacher, a room or a course (409 with a message saying what clashes).
- **Discussions**: each course has its own board. Everyone signed in can start a discussion (title and opening post), reply (optionally to a specific reply), edit or delete their own posts and report a post. The course's teacher and admins can pin, lock, mark the answer and delete any post; a deleted reply stays as a short placeholder so the conversation still reads well. Posts are plain text. Replies notify the asker, the person answered and the course teacher; reports notify the course teacher and admins (never the writer, and without naming the reporter) and are audited. Creating threads, replies and reports is limited to 30 per 10 minutes per user.
- **Notifications**: in-app alerts, with an unread badge in the sidebar and on the phone menu button (refreshed every minute). People are told about: a newly published assignment or quiz (the active students enrolled in that course), being added to or removed from a course, being marked absent, a grade or an adjusted grade, discussion replies and reports, and (teachers) a student's new or updated hand-in. Staff can also send a message (`POST /notifications`; teachers only to students). The page filters unread, marks one or all as read, removes and pages through older ones.
- **Audit logs** (admin only, read-only through the API) for role changes, deactivations, password resets, deletions, grade overrides, submission grading, attendance corrections, staff-sent notifications, and creating, changing or deleting courses, assignments and quizzes. Entries record who, what, which record, the before/after values and the IP address. Grade overrides are saved in the same transaction as their audit entry; the rest are best-effort. The page filters by action, record type and date, and shows what changed.
- **Dashboards** with role-specific stats.
- **Phones and tablets**: the whole app is usable on a phone (see *Phones and tablets* below).

### File uploads

Admins and teachers can upload images, videos and files for module content. Files are sent to the API, which forwards them to [Cloudinary](https://cloudinary.com) and returns the URL and `public_id`. The module row stores the result, and the old Cloudinary asset is removed after a module's file is replaced, cleared or the module is deleted. Cloudinary credentials are required at server startup. Everyone can also upload their own profile picture from Settings; it is stored once at 256×256 and replaced in place.

| What | Who | Stored as | Limit |
|------|-----|-----------|-------|
| Assignment submission (a file or a link, never both) | student, for their own work | **private** (`authenticated`); replaced or deleted along with the submission | 10 MB |
| Assignment material (one file per assignment, next to the optional link) | the course's teacher/admin | **private**; anyone signed in can download it | 10 MB |
| Quiz question picture | the course's teacher/admin, until a student has taken the quiz | public image (a picture is never an answer) | 5 MB |

Private files are never exposed by URL. `GET /submissions/:id/download` and `GET /assignments/:id/attachment` check who is asking, then return a signed `attachment` link that expires after 5 minutes. A submission can be downloaded by its owner and by the course's teacher or an admin. Deleting an assignment, quiz, question or account also removes the files that belonged to it from Cloudinary (best effort). Allowed document types: PDF, Word, PowerPoint, Excel, OpenDocument, text, CSV, RTF, ZIP, JPG, PNG, WebP. The server refuses to start (with instructions) until `server/sql/cloudinary-uploads.sql` has been run.

### Phones and tablets

The client is responsive. Below 768px (Tailwind's `md` breakpoint) the fixed sidebar is replaced by a slide-in menu opened from the top bar (the menu button shows a dot when you have unread notifications), the weekly timetable becomes a day-by-day list, dialogs fit the screen and scroll inside, and form fields use 16px text so iOS Safari does not zoom in when one is focused. From 768px up the desktop layout is unchanged. Wide tables scroll sideways inside their card. Layouts are checked by hand (browser device mode and a real phone); there are no automated layout tests.

## Tech Stack

- **Frontend** (`client/`): React 18, Vite 6, TypeScript, Tailwind CSS, Radix UI primitives (shadcn-style components), React Router 7, React Query, react-hook-form + zod, Axios, Tiptap (rich-text editor) and DOMPurify (sanitizes rich text before it is shown).
- **Backend** (`server/`): Node 20+, Express 4, TypeScript (ESM), zod validation, `jsonwebtoken`, `bcryptjs`, helmet, CORS, `express-rate-limit`, `multer` and `cloudinary` for uploads.
- **Database**: PostgreSQL on [Neon](https://neon.tech), accessed through `@neondatabase/serverless` (tagged-template `sql` queries).
- **Hosting**: client on Vercel (SPA rewrite in `client/vercel.json`), API on Render.

## Repo Structure

```
pbsi-platform/
├── client/                 # Vite + React frontend
│   └── src/{pages,components,contexts,hooks,lib}
├── server/                 # Express API
│   ├── sql/                # One-off SQL scripts to run in the Neon SQL editor (see below)
│   └── src/{routes,controllers,middleware,utils,config,types}
├── neon.ts                 # Neon project config (branch policy)
├── package.json            # Only the Neon config dependencies; there are no root scripts
├── DESIGN_SYSTEM.md        # NOTE: describes the separate PBSI marketing site, not this app
└── README.md
```

## Getting Started

Requires Node.js 20 or newer, a Neon (or any PostgreSQL) database and a Cloudinary account.

```
# 1. Server
cd server
cp .env.example .env        # then fill in the values
npm install
npm run dev                 # http://localhost:4000

# 2. Client (in a second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173 (proxies /api to localhost:4000)
```

> **Windows only:** `server`'s `dev` script uses `set TS_NODE_TRANSPILE_ONLY=true&&`, which works in Windows `cmd`/npm but not on macOS/Linux. On those systems run `TS_NODE_TRANSPILE_ONLY=true node --env-file=.env --watch --experimental-specifier-resolution=node --loader ts-node/esm src/server.ts`.

Other scripts, run inside `server/` or `client/` (the repo root has no scripts): `npm run typecheck`, `npm run build`, `npm start` (server only; runs the compiled `dist/`), `npm run preview` (client only; serves the production build).

## Environment Variables

### Server (`server/.env`)

| Variable                                                               | Purpose                                                                         |
|------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| `PORT`                                                                 | API port (default `4000`)                                                       |
| `NODE_ENV`                                                             | `development` or `production` (production sets secure, `SameSite=None` cookies) |
| `CORS_ORIGIN`                                                          | Allowed frontend origin, e.g. `http://localhost:5173`                           |
| `TRUST_PROXY_HOPS`                                                     | Optional. Proxies in front of the server (default `1`, right for Render). Rate limits use the client address, so a wrong value makes everyone look like one network |
| `DATABASE_URL`                                                         | Neon connection string (`?sslmode=require`)                                     |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                              | Token signing secrets (use long random values)                                  |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`                      | Token lifetimes (default `15m` / `7d`)                                          |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required: the server refuses to start without them (`src/config/cloudinary.ts`) |

### Client (`client/.env`)

```
VITE_API_URL=http://localhost:4000     # optional; defaults to /api (Vite dev proxy)
```

`/api` is appended automatically if missing.

## Database

The app expects these tables (derived from the queries in `server/src/controllers/`):

`users`, `profiles`, `students`, `teachers`, `courses`, `modules`, `assignments`, `submissions`, `quizzes`, `quiz_questions`, `quiz_attempts`, `grades`, `attendance`, `timetable`, `discussion_threads`, `discussion_replies`, `discussion_reports`, `notifications`, `audit_logs`, `enrollments`.

There is no full schema file in the repo yet; create the tables in Neon first. Column names are the ones the controllers use.

### SQL scripts (`server/sql/`)

Run these by hand in the Neon SQL editor. All are safe to run more than once. Scripts marked "check for duplicates first" begin with queries that must return no rows before you create the index.

| Script                             | When                                                                     | Notes                                                                                                                                                                        |
|------------------------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `assignment-publish.sql`           | **Before** deploying the draft/publish server  | Adds `assignments.is_published`. Existing assignments stay published; new ones start as drafts                                                                              |
| `course-enrollments.sql`           | **Before** deploying the enrollment server     | Creates `enrollments` and enrolls every existing student in every existing course, so nothing changes on day one. Run once; running it again never re-enrolls someone you removed |
| `cloudinary-uploads.sql`           | **Before** deploying the upload update (the server checks at startup) | Adds the file columns for submissions, assignment materials and quiz question pictures, and lets `submissions.file_url` be NULL (a file hand-in has no link) |
| `token-revocation.sql`             | **Before** deploying the current server                                  | Adds `users.tokens_valid_after`; the API reads it on every request                                                                                                           |
| `users-created-by.sql`             | **Before** deploying the server that lets teachers delete their students | Adds `users.created_by` (who created each account); existing accounts stay `NULL`, so only admins can delete them                                                            |
| `discussions.sql`                  | **Before** deploying the discussions update                              | Adds the body, pin, lock, answer, edit and soft-delete columns to `discussion_threads` / `discussion_replies` and creates `discussion_reports`. Safe to run more than once; nothing is dropped |
| `attendance-unique-index.sql`      | **Before** using attendance                                              | Required. Attendance saves use `ON CONFLICT (student_id, course_id, date)`, which fails without a unique index on exactly those columns. Check for duplicates first          |
| `notifications-audit-hardening.sql` | Before or with the notifications/audit update                           | Adds indexes for notifications and audit logs, turns empty notification links into NULL and changes `audit_logs.actor_id` from `ON DELETE CASCADE` to `RESTRICT`, so deleting a user can never erase their audit trail. Safe to run more than once |
| `audit-logs-append-only.sql`       | Optional, after the script above                                         | Makes `audit_logs` append-only: any UPDATE, DELETE or TRUNCATE fails. Drop the triggers (instructions inside) to clear test data                                              |
| `2d-backfill-grades.sql`           | After deploying                                                          | One-time copy of old graded submissions and quiz attempts into `grades`                                                                                                      |
| `2d-optional-unique-indexes.sql`   | After the backfill                                                       | Optional. Check for duplicates first; adds unique indexes on `grades` and `quiz_attempts`                                                                                    |
| `timetable-constraints.sql`        | After deploying the timetable update                                     | Optional safety net. Check for duplicates first; adds time/day checks and unique indexes so a teacher, room or course cannot be double-booked even by two simultaneous saves |
| `drop-students-cumulative-gpa.sql` | Eventually, once the latest code has been running fine                   | Drops the unused `students.cumulative_gpa` column                                                                                                                            |

## API Overview

All routes are under `/api` and need a valid session except `/auth/login`, `/auth/logout`, `/auth/refresh` and `/health`.

| Prefix                           | Notes                                                                                                                      |
|----------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `/auth`                          | `login`, `logout`, `refresh`, `me`, `PATCH me` (own details), `PUT me/password`, `PUT/DELETE me/avatar` (`register` is disabled) |
| `/users`                         | List/create/edit, activate/deactivate, reset password, delete (admin/teacher, role-limited)                                |
| `/students`                      | List (admin/teacher), detail, `export/csv` (admin)                                                                         |
| `/teachers`                      | List (admin)                                                                                                               |
| `/courses`, `/modules`           | CRUD scoped to the owning teacher or an admin; students only get the courses they are enrolled in. `GET/POST /courses/:id/enrollments` and `DELETE /courses/:id/enrollments/:student_id` (the course's teacher or an admin) |
| `/upload`                        | `POST /:kind` (`image`, `video` or `file`; field name `file`) and `DELETE /:publicId`, admin/teacher only; stored in Cloudinary |
| `/assignments`, `/submissions`   | CRUD and grading; `PATCH /assignments/:id { is_published }` publishes or unpublishes. Files: `GET/PUT/DELETE /assignments/:id/attachment` (material), `POST /submissions/file` (multipart `assignment_id` + `file`), `GET /submissions/:id/download` |
| `/quizzes`, `/quiz-attempts`     | Quiz and question management, student attempts; `PUT/DELETE /quizzes/:id/questions/:question_id/image` for question pictures |
| `/grades`                        | List (scoped by role), `summary` (per-course average, high/low, assignment vs quiz average, at-risk count; filters `student_id`, `course_id`, `term`), `gpa/:student_id` (average percentage; `me` for the signed-in student), `PATCH /:id` adjust a grade |
| `/attendance`                    | List, `roster` (admin/teacher), `summary/:student_id`, `POST /` (one record) and `POST /bulk` (admin/teacher)              |
| `/timetable`                     | List, create, update, delete (admin/teacher); double-booking returns 409                                                   |
| `/discussions`                   | `GET /:course_id` (threads), `POST /`, `GET/PATCH/DELETE /threads/:id`, `POST /threads/:id/report`, `GET/POST /:thread_id/replies`, `PATCH/DELETE /replies/:id`, `POST /replies/:id/report` |
| `/notifications`                 | `GET /`, `GET /unread-count`, `PATCH /read-all`, `PATCH /:id/read`, `DELETE /:id`, and `POST /` (staff send a message; teachers only to students) |
| `/audit-logs`                    | Admin only; read-only, with `action`, `entity_type`, `entity_id`, `from`, `to`, `page` and `limit` filters                |
| `/dashboard/stats`               | Role-specific counts                                                                                                       |
| `/health`                        | Liveness check                                                                                                             |

## Deployment

The client and the API are deployed separately, and each needs to know the other's address.

**Client on Vercel**: Framework preset Vite, root directory `client`, build command `npm run build`, output directory `dist`, and the environment variable `VITE_API_URL=https://<your-api>.onrender.com`. The single-page-app rewrite is already in `client/vercel.json`.

**API on Render**: runtime Node, root directory `server`, build command `npm install && npm run build`, start command `npm start`, and the server environment variables above with `NODE_ENV=production`. Render provides `PORT` itself.

Things that commonly go wrong:

- `CORS_ORIGIN` must be exactly the client's address, such as `https://pbsi-platform.vercel.app`, with no trailing slash. The server reads only `CORS_ORIGIN`; if it is missing it falls back to `http://localhost:5173` and the browser blocks every request with a CORS error.
- Run the SQL scripts marked **Before** in Neon before deploying the server that needs them.
- On Render's free plan the API sleeps when idle, so the first request after a quiet period can take about 30 seconds. The client waits and retries instead of signing people out.

## Security

- Passwords hashed with bcrypt; access (15 min) and refresh (7 day) JWTs are set as httpOnly cookies. The client also keeps the access token in `localStorage` and sends it as a Bearer header, refreshing it automatically on a 401.
- Every request re-checks that the account is active and that the token was issued after `tokens_valid_after`.
- Zod validation on request bodies; UUID parameters are validated so malformed ids return 400, not a database error.
- `helmet`, CORS locked to `CORS_ORIGIN`, a 10 kB JSON body limit, and rate limiting that is designed never to lock out people who did nothing wrong (`server/src/middleware/rateLimiters.ts`): only *failed* logins count, 10 per email per network and 300 per network per 15 min (a class sharing one Wi-Fi never blocks itself); signed-in requests are counted per person (1000 per 15 min), not per network; token refreshes per session; uploads per person. A blocked request gets a message saying how many minutes to wait. The app only signs someone out on a definite 401/403, never because the server was busy, waking up or rate limiting, and it retries a slow start for about 30 seconds before giving up.
- Module uploads are restricted to admins and teachers, and the delete endpoint only touches module media. Profile pictures are the one upload open to everyone, for their own account only (JPG/PNG/WebP, checked by content, stored at `pbsi/avatars/<user id>`).
- Audit log entries for sensitive admin and grading actions.

## Known Gaps

- No schema/migration tool or tests yet; schema changes are manual SQL in `server/sql/`.
- Uploads are buffered in server memory (multer `memoryStorage`) before going to Cloudinary, so each kind has a cap: 100 MB for module videos, 10 MB for module images/files, 2 MB for profile pictures. Keep these at or below your Cloudinary plan's per-file limit.
- Submission and material files are checked by extension and size only (no virus scan). They are never opened inline: downloads are `attachment` links.
- `DESIGN_SYSTEM.md` documents a different repository (the PBSI marketing site).
