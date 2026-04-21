# LectureFlow

A real-time lecture feedback system built for my final year project at the University of Leeds. Students send emoji reactions (got it, neutral, confused, lost) per slide during live lectures, and lecturers see aggregated feedback as it comes in. After the session, both sides get a report breaking down how each slide landed.

There are three user roles: **admin**, **lecturer**, and **student**.

## What it does

- **Live feedback** - students tap an emoji to say how they're finding each slide. The lecturer sees the distribution update in real time.
- **Q&A** - students can ask questions during the session, upvote each other's questions, and the lecturer can mark them as answered.
- **Quick polls** - lecturers can fire off true/false or multiple-choice polls mid-session and see results instantly.
- **Confusion context** - when a student is confused, they can optionally highlight the bit of the slide that's unclear and write a short explanation.
- **Pace feedback** - students can signal if the lecturer is going too fast, too slow, or just right.
- **Slide annotations** - lecturers can draw on slides live (pen, eraser, laser pointer), and students see it in real time. Students can also request annotation access.
- **Post-lecture reflections** - after a session ends, students can jot down what they found most important and what's still unclear.
- **Per-slide notes** - students can take personal notes on each slide during the lecture.
- **Session reports** - both lecturers and students get a post-session breakdown with per-slide feedback, timing data, questions asked, and poll results. Lecturers also get AI-generated recommendations.
- **Admin panel** - user management, TOTP provisioning, and impersonation for debugging.

## Tech stack

This is a pnpm monorepo with three packages:

| Package | What it is |
|---|---|
| `apps/api` | Hono REST API + WebSocket server running on Node.js, with PostgreSQL via Drizzle ORM |
| `apps/web` | React 18 SPA built with Vite and Tailwind CSS, using React Router v6 |
| `packages/shared` | Shared TypeScript types and interfaces used by both the API and the frontend |

## Getting started

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL

### Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/9ali-oop/lecture-feedback.git
cd lecture-feedback
pnpm install
```

2. Set up the database - copy the example env file and fill in your details:

```bash
cp apps/api/.env.example apps/api/.env
```

You'll need to set `DATABASE_URL`, `JWT_SECRET`, and `ADMIN_EMAIL` at minimum.

3. Push the schema to your database and seed the admin user:

```bash
pnpm db:push
pnpm db:seed
```

The seed script will print a TOTP secret and QR code for the admin account.

4. Start the dev servers:

```bash
pnpm dev
```

This runs the API on port 3000 and the web app on port 5173. The Vite dev server proxies `/api` and `/ws` requests to the backend automatically.

## Other useful commands

```bash
pnpm build              # Build all packages
pnpm db:studio          # Open Drizzle Studio (database browser)
pnpm --filter @lecture-feedback/api dev    # Run just the API
pnpm --filter @lecture-feedback/web dev    # Run just the frontend
```

## How auth works

Authentication is TOTP-based (passwordless). The admin creates user accounts, which generates a TOTP secret and QR code. Users scan the QR code with an authenticator app, then log in by entering their code. JWTs are issued with 24h expiry.

For development, any account with an email like `sc####@leeds.ac.uk` will accept the code `123456`.

## Project structure

```
lecture-feedback/
  apps/
    api/
      src/
        db/           # Schema, seed data, connection setup
        lib/          # JWT, TOTP, storage, recommendations
        middleware/    # Auth middleware
        routes/       # REST API routes
        ws/           # WebSocket session manager
    web/
      src/
        components/   # Reusable UI components
        contexts/     # React contexts (auth)
        hooks/        # Custom hooks (annotations, etc.)
        lib/          # API client, WS helper
        pages/        # Page components (admin, lecturer, student)
  packages/
    shared/
      src/            # Shared types and interfaces
```
