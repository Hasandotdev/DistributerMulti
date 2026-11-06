-- 001_multi_company_schema.sql
-- Multi-Company Distribution & Credit Management System
-- Safe to re-run: idempotent create / add-column / drop+recreate policies

create extension if not exists "uuid-ossp";

-- ============================================
-- COMPANIES
-- ============================================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  logo_url text,
  bill_counter bigint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- ============================================
-- COMPANY MEMBERSHIPS (user <-> company, role)
-- ============================================

create table if not exists company_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  role text not null check (role in ('admin', 'employee')),
  email text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  unique (user_id, company_id)
);

create index if not exists idx_company_memberships_user on company_memberships(user_id);
create index if not exists idx_company_memberships_company on company_memberships(company_id);

-- ============================================
-- CORE TABLES (with company_id)
-- ============================================

create table if not exists routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique (company_id, name)
);

create table if not exists employees (
  id text primary key,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  employee_code text,
  auth_user_id uuid references auth.users(id) on delete set null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists employee_routes (
  employee_id text not null references employees(id) on delete cascade,
  route_id uuid not null references routes(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  primary key (employee_id, route_id)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  shop_code text,
  name text not null,
  address text,
  phone text,
  route_id uuid references routes(id),
  opening_balance numeric default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create unique index if not exists idx_customers_shop_code
  on customers(company_id, shop_code) where shop_code is not null;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  unit text default 'pcs',
  rate numeric default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  bill_number text not null,
  customer_id uuid references customers(id),
  employee_id text references employees(id),
  bill_date date not null default current_date,
  total_amount numeric not null default 0,
  paid_amount numeric default 0,
  credit_amount numeric generated always as (total_amount - paid_amount) stored,
  payment_status text check (payment_status in ('cash','credit','partial')) default 'cash',
  notes text,
  is_voided boolean default false,
  created_at timestamptz default now(),
  unique (company_id, bill_number)
);

create table if not exists recoveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid references customers(id),
  employee_id text references employees(id),
  amount numeric not null,
  recovery_date date not null default current_date,
  notes text,
  created_at timestamptz default now()
);

-- ============================================
-- INDEXES
-- ============================================

create index if not exists idx_routes_company on routes(company_id);
create index if not exists idx_employees_company on employees(company_id);
create index if not exists idx_employees_auth_user on employees(auth_user_id);
create index if not exists idx_employee_routes_route on employee_routes(route_id);
create index if not exists idx_employee_routes_company on employee_routes(company_id);
create index if not exists idx_customers_company on customers(company_id);
create index if not exists idx_customers_route on customers(route_id);
create index if not exists idx_products_company on products(company_id);
create index if not exists idx_bills_company on bills(company_id);
create index if not exists idx_bills_customer on bills(customer_id);
create index if not exists idx_bills_employee on bills(employee_id);
create index if not exists idx_bills_date on bills(bill_date);
create index if not exists idx_recoveries_company on recoveries(company_id);
create index if not exists idx_recoveries_customer on recoveries(customer_id);
create index if not exists idx_recoveries_employee on recoveries(employee_id);
create index if not exists idx_recoveries_date on recoveries(recovery_date);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Global role from JWT metadata: super_admin | admin | employee
create or replace function get_user_role(p_user_id uuid)
returns text
language sql
security definer
stable
as $$
  select coalesce(
    (select raw_user_meta_data ->> 'role' from auth.users where id = p_user_id),
    'employee'
  );
$$;

-- Company ids the user belongs to (empty for super_admin who can access all)
create or replace function get_user_company_ids(p_user_id uuid)
returns uuid[]
language sql
security definer
stable
as $$
  select coalesce(
    (
      select array_agg(cm.company_id)
      from company_memberships cm
      where cm.user_id = p_user_id
        and cm.is_active = true
    ),
    '{}'::uuid[]
  );
$$;

create or replace function is_super_admin(p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select get_user_role(p_user_id) = 'super_admin';
$$;

-- True if user can access the given company
create or replace function user_has_company_access(p_user_id uuid, p_company_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    is_super_admin(p_user_id)
    or p_company_id = any(get_user_company_ids(p_user_id));
$$;

-- Membership role within a company (admin | employee | null)
create or replace function get_user_company_role(p_user_id uuid, p_company_id uuid)
returns text
language sql
security definer
stable
as $$
  select cm.role
  from company_memberships cm
  where cm.user_id = p_user_id
    and cm.company_id = p_company_id
    and cm.is_active = true;
$$;

-- Route ids for the user's employee record(s) within accessible companies
create or replace function get_user_route_ids(p_user_id uuid)
returns uuid[]
language sql
security definer
stable
as $$
  select coalesce(
    (
      select array_agg(distinct er.route_id)
      from employee_routes er
      join employees e on e.id = er.employee_id
      where e.auth_user_id = p_user_id
        and e.is_active = true
        and user_has_company_access(p_user_id, er.company_id)
    ),
    '{}'::uuid[]
  );
$$;

-- Employee ids visible to the user (self + same-route colleagues), company-scoped
create or replace function get_user_route_employee_ids(p_user_id uuid)
returns text[]
language sql
security definer
stable
as $$
  select coalesce(array_agg(distinct id), '{}'::text[])
  from employees
  where is_active = true
    and user_has_company_access(auth.uid(), company_id)
    and (
      auth_user_id = p_user_id
      or id in (
        select er.employee_id
        from employee_routes er
        where er.route_id = any(get_user_route_ids(p_user_id))
      )
    );
$$;

-- Per-company bill number: BILL-<CODE>-0001
create or replace function generate_bill_number(p_company_id uuid)
returns text
language plpgsql
security definer
as $$
declare
  v_code text;
  v_next bigint;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  update companies
     set bill_counter = bill_counter + 1
   where id = p_company_id
  returning code, bill_counter into v_code, v_next;

  if v_code is null then
    raise exception 'company not found';
  end if;

  return 'BILL-' || upper(v_code) || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table companies enable row level security;
alter table company_memberships enable row level security;
alter table routes enable row level security;
alter table employees enable row level security;
alter table employee_routes enable row level security;
alter table customers enable row level security;
alter table products enable row level security;
alter table bills enable row level security;
alter table recoveries enable row level security;

-- ============================================
-- POLICIES (drop + recreate = idempotent)
-- ============================================

-- COMPANIES
drop policy if exists "Super admin manages companies" on companies;
drop policy if exists "Members can view their companies" on companies;

create policy "Super admin manages companies"
  on companies for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Members can view their companies"
  on companies for select
  using (id = any(get_user_company_ids(auth.uid())));

-- COMPANY MEMBERSHIPS
drop policy if exists "Super admin manages memberships" on company_memberships;
drop policy if exists "Users can view own memberships" on company_memberships;
drop policy if exists "Company admins can view company members" on company_memberships;
drop policy if exists "Company admins can add members" on company_memberships;
drop policy if exists "Company admins can update members" on company_memberships;

create policy "Super admin manages memberships"
  on company_memberships for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Users can view own memberships"
  on company_memberships for select
  using (user_id = auth.uid());

create policy "Company admins can view company members"
  on company_memberships for select
  using (
    get_user_company_role(auth.uid(), company_id) = 'admin'
  );

create policy "Company admins can add members"
  on company_memberships for insert
  with check (
    get_user_company_role(auth.uid(), company_id) = 'admin'
  );

create policy "Company admins can update members"
  on company_memberships for update
  using (
    get_user_company_role(auth.uid(), company_id) = 'admin'
  )
  with check (
    get_user_company_role(auth.uid(), company_id) = 'admin'
  );

-- ROUTES
drop policy if exists "Super admin manages routes" on routes;
drop policy if exists "Company admins manage routes" on routes;
drop policy if exists "Members can view company routes" on routes;
drop policy if exists "Employees can view assigned routes" on routes;

create policy "Super admin manages routes"
  on routes for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage routes"
  on routes for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company routes"
  on routes for select
  using (company_id = any(get_user_company_ids(auth.uid())));

create policy "Employees can view assigned routes"
  on routes for select
  using (
    get_user_role(auth.uid()) = 'employee'
    and id = any(get_user_route_ids(auth.uid()))
  );

-- EMPLOYEES
drop policy if exists "Super admin manages employees" on employees;
drop policy if exists "Company admins manage employees" on employees;
drop policy if exists "Members can view company employees" on employees;
drop policy if exists "Employee can update own record" on employees;

create policy "Super admin manages employees"
  on employees for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage employees"
  on employees for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company employees"
  on employees for select
  using (company_id = any(get_user_company_ids(auth.uid())));

create policy "Employee can update own record"
  on employees for update
  using (
    get_user_role(auth.uid()) = 'employee'
    and auth_user_id = auth.uid()
  )
  with check (
    get_user_role(auth.uid()) = 'employee'
    and auth_user_id = auth.uid()
  );

-- EMPLOYEE ROUTES
drop policy if exists "Super admin manages employee_routes" on employee_routes;
drop policy if exists "Company admins manage employee_routes" on employee_routes;
drop policy if exists "Members can view company employee_routes" on employee_routes;

create policy "Super admin manages employee_routes"
  on employee_routes for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage employee_routes"
  on employee_routes for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company employee_routes"
  on employee_routes for select
  using (company_id = any(get_user_company_ids(auth.uid())));

-- CUSTOMERS
drop policy if exists "Super admin manages customers" on customers;
drop policy if exists "Company admins manage customers" on customers;
drop policy if exists "Members can view company customers" on customers;

create policy "Super admin manages customers"
  on customers for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage customers"
  on customers for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company customers"
  on customers for select
  using (company_id = any(get_user_company_ids(auth.uid())));

-- PRODUCTS
drop policy if exists "Super admin manages products" on products;
drop policy if exists "Company admins manage products" on products;
drop policy if exists "Members can view company products" on products;

create policy "Super admin manages products"
  on products for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage products"
  on products for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company products"
  on products for select
  using (company_id = any(get_user_company_ids(auth.uid())));

-- BILLS
drop policy if exists "Super admin manages bills" on bills;
drop policy if exists "Company admins manage bills" on bills;
drop policy if exists "Members can view company bills" on bills;

create policy "Super admin manages bills"
  on bills for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage bills"
  on bills for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company bills"
  on bills for select
  using (company_id = any(get_user_company_ids(auth.uid())));

-- RECOVERIES
drop policy if exists "Super admin manages recoveries" on recoveries;
drop policy if exists "Company admins manage recoveries" on recoveries;
drop policy if exists "Members can view company recoveries" on recoveries;

create policy "Super admin manages recoveries"
  on recoveries for all
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy "Company admins manage recoveries"
  on recoveries for all
  using (get_user_company_role(auth.uid(), company_id) = 'admin')
  with check (get_user_company_role(auth.uid(), company_id) = 'admin');

create policy "Members can view company recoveries"
  on recoveries for select
  using (company_id = any(get_user_company_ids(auth.uid())));
