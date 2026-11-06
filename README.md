# DistributerMulti — Multi-Company Distribution & Credit Management System

Multi-tenant edition of the Distribution & Credit system. One app manages **multiple company accounts** (e.g. Cadbury, Vital), each with isolated routes, employees, customers, products, bills, and recoveries.

**Stack:** React 19 + Vite + TypeScript + Tailwind + Supabase (Postgres, Auth, RLS)

## Features

- **Multiple companies** — create companies with a short code; bill numbers look like `BILL-CAD-0001`
- **Roles**
  - `super_admin` — create/manage companies, assign members, switch company from the header
  - `admin` — full CRUD inside their own company only
  - `employee` — assigned routes/customers/bills inside their company only
- Same feature set as Distributer: dashboard KPIs, bills, recoveries, customers, routes, employees (multi-route), reports (customer/route/employee/shop), print route report, bulk Excel upload, PDF/Excel export
- **Row Level Security** enforced at the database level

## Repository layout

```
frontend/                 React SPA
supabase/migrations/      SQL schema (run in Supabase SQL editor)
Logo.png
```

## Setup

### 1. Create a Supabase project

1. Create a new project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the entire contents of:
   `supabase/migrations/001_multi_company_schema.sql`
3. From **Project Settings → API**, copy the Project URL and anon key

### 2. Configure the frontend

```bash
cd frontend
cp .env.example .env
# edit .env:
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...
npm install
npm run dev
```

### 3. Create the first super admin

1. Sign up once through the app (or Supabase Auth → Users → Add user) with your admin email/password
2. In Supabase **SQL Editor**, run (replace the email):

```sql
update auth.users
set raw_user_meta_data = raw_user_meta_data || '{"role": "super_admin"}'::jsonb
where email = 'you@example.com';
```

3. Log out and log back in (JWT metadata refreshes on sign-in)
4. Open **Companies** in the sidebar → **Add Company** (e.g. name `Cadbury`, code `CAD`)
5. Use the header company switcher to move between companies

### 4. Invite company staff

From the **Companies** page → members icon → **Add Member**:

- **Company Admin** — gets full access to that company only
- **Employee** — gets an employee record + login for assigned routes

Employees can also be created from the **Employees** page (creates login + membership automatically).

## Security model

| Layer | Mechanism |
|---|---|
| Auth | Supabase Auth email/password |
| Roles | JWT `user_metadata.role` (`super_admin` / `admin` / `employee`) |
| Company membership | `company_memberships` table |
| Data isolation | `company_id` on every table + RLS policies in migration |
| Client scoping | Every query filters `.eq('company_id', activeCompany.id)` |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run lint` | Oxlint |

## Deploy

- Frontend: Vercel (SPA rewrite already in `frontend/vercel.json`)
- Database: Supabase hosted project
