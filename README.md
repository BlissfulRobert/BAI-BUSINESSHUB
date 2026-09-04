# BAI Business Hub

A premium room booking platform for meeting and conference rooms.

## Tech Stack

- **Frontend:** SvelteKit + TypeScript + Tailwind CSS
- **Backend:** Supabase (Auth + PostgreSQL + Storage)
- **Deployment:** Vercel (frontend) + Supabase Cloud (backend)

## Features

- Public room browsing with detailed information
- Real-time availability checking
- Simple booking flow
- Client dashboard (view/cancel bookings)
- Admin panel (manage rooms, bookings, users)
- Authentication (login, register, password reset)

## Project Structure

```
bai-business-hub/
├── frontend/           # SvelteKit application
│   ├── src/
│   │   ├── routes/     # Pages (file-based routing)
│   │   ├── lib/        # Components, stores, utils
│   │   └── app.css     # Tailwind entry
│   └── static/         # Static assets
├── backend/            # Supabase configuration
│   ├── supabase/
│   │   ├── migrations/ # SQL schema
│   │   └── seed.sql    # Seed data
│   └── policies/       # RLS notes
└── docs/               # Documentation
```

## Setup Instructions

### Prerequisites

- Node.js 18+
- Supabase CLI
- npm or pnpm

### 1. Clone and Install

```bash
cd bai-business-hub/frontend
npm install
```

### 2. Set Up Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Copy your project URL and keys
3. Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

4. Fill in your Supabase credentials:

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Set Up Database

Run the migration in your Supabase SQL editor:

```bash
# Copy the contents of backend/supabase/migrations/001_initial_schema.sql
# Paste into Supabase SQL Editor and run
```

Then seed the data:

```bash
# Copy the contents of backend/supabase/seed.sql
# Paste into Supabase SQL Editor and run
```

### 4. Run Development Server

```bash
cd frontend
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173)

## User Roles

| Role | Description |
|------|-------------|
| **Admin** | Full access to manage rooms, bookings, and users |
| **Client** | Can book rooms, view/cancel their bookings |
| **Spectator** | Can browse rooms, must login to book |

## Rooms

| Room | Capacity | Price |
|------|----------|-------|
| Conference Room | 16 people | $75/hr |
| Consultation Room | 8 people | $45/hr |

## License

Private - BAI Business Hub
