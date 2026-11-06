import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useCompany } from '@/contexts/CompanyContext';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Plus, Edit, Trash2, Users, UserPlus, Power, PowerOff } from 'lucide-react';
import type { Company, CompanyMembership, MembershipRole } from '@/types/database';

interface MemberRow extends CompanyMembership {
  employee_name?: string | null;
}

export default function CompaniesPage() {
  const { refreshCompanies } = useCompany();

  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Company | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', code: '' });

  const [membersFor, setMembersFor] = useState<Company | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberForm, setMemberForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'admin' as MembershipRole,
  });
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [removeMember, setRemoveMember] = useState<MemberRow | null>(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name');
    if (error) {
      console.error('Error fetching companies:', error);
    } else {
      setRows((data as Company[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const code = form.code.trim().toUpperCase();

    let error;
    if (editing) {
      ({ error } = await supabase
        .from('companies')
        .update({ name: form.name.trim(), code })
        .eq('id', editing.id));
    } else {
      ({ error } = await supabase
        .from('companies')
        .insert({ name: form.name.trim(), code }));
    }

    if (error) {
      alert(error.message.includes('duplicate') ? 'Company name or code already exists' : 'Error saving company');
    } else {
      setShowForm(false);
      setEditing(null);
      setForm({ name: '', code: '' });
      await fetchCompanies();
      await refreshCompanies();
    }
    setSubmitting(false);
  }

  async function handleToggleActive(company: Company) {
    const { error } = await supabase
      .from('companies')
      .update({ is_active: !company.is_active })
      .eq('id', company.id);
    if (error) {
      alert('Error updating company');
    } else {
      await fetchCompanies();
      await refreshCompanies();
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', deleteConfirm.id);
    if (error) {
      alert('Cannot delete company — data may still exist');
    } else {
      setDeleteConfirm(null);
      await fetchCompanies();
      await refreshCompanies();
    }
  }

  async function openMembers(company: Company) {
    setMembersFor(company);
    setMembersLoading(true);
    const { data } = await supabase
      .from('company_memberships')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_active', true)
      .order('created_at');

    const list = (data as CompanyMembership[]) ?? [];
    const withNames = await Promise.all(
      list.map(async (m) => {
        const { data: emp } = await supabase
          .from('employees')
          .select('name')
          .eq('auth_user_id', m.user_id)
          .eq('company_id', company.id)
          .limit(1)
          .maybeSingle();
        return { ...m, employee_name: emp?.name ?? null };
      }),
    );
    setMembers(withNames);
    setMembersLoading(false);
  }

  async function handleCreateMember(e: React.FormEvent) {
    e.preventDefault();
    if (!membersFor) return;
    if (memberForm.password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    setMemberSubmitting(true);

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: memberForm.email.trim(),
        password: memberForm.password,
        options: {
          data: {
            role: memberForm.role,
            full_name: memberForm.name.trim(),
          },
        },
      });

      if (signUpError) throw signUpError;

      const authUser = signUpData.user;
      if (!authUser) throw new Error('No user returned from sign up');

      const { error: memberError } = await supabase.from('company_memberships').insert({
        user_id: authUser.id,
        company_id: membersFor.id,
        role: memberForm.role,
        email: memberForm.email.trim().toLowerCase(),
      });
      if (memberError) throw memberError;

      if (memberForm.role === 'employee') {
        const { error: empError } = await supabase.from('employees').insert({
          id: `DSR-${Date.now().toString().slice(-5)}`,
          company_id: membersFor.id,
          name: memberForm.name.trim(),
          auth_user_id: authUser.id,
          employee_code: null,
          is_active: true,
        });
        if (empError) console.error('Employee record error:', empError);
      }

      setShowMemberForm(false);
      setMemberForm({ name: '', email: '', password: '', role: 'admin' });
      await openMembers(membersFor);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating member';
      alert(msg);
    } finally {
      setMemberSubmitting(false);
    }
  }

  async function handleRemoveMember() {
    if (!removeMember || !membersFor) return;
    const { error } = await supabase
      .from('company_memberships')
      .update({ is_active: false })
      .eq('id', removeMember.id);
    if (error) {
      alert('Error removing member');
    } else {
      setRemoveMember(null);
      await openMembers(membersFor);
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'Company',
      sortable: true,
      render: (_value: string, row: Company) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {row.name.charAt(0).toUpperCase()}
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    { key: 'code', label: 'Code', sortable: true },
    {
      key: 'is_active',
      label: 'Status',
      sortable: false,
      render: (_value: boolean, row: Company) => (
        <span
          className={
            row.is_active
              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400'
              : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }
        >
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (_value: string, row: Company) =>
        new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      render: (_value: unknown, row: Company) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openMembers(row);
            }}
            title="Manage members"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Users className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row);
              setForm({ name: row.name, code: row.code });
              setShowForm(true);
            }}
            title="Edit"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Edit className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleActive(row);
            }}
            title={row.is_active ? 'Deactivate' : 'Activate'}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {row.is_active ? (
              <PowerOff className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm(row);
            }}
            title="Delete"
            className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Companies
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage company accounts and their team members
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setForm({ name: '', code: '' });
            setShowForm(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Company
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <DataTable
          data={rows}
          columns={columns}
          loading={loading}
          emptyMessage="No companies yet. Create your first company."
        />
      </div>

      {/* Company form */}
      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
        title={editing ? 'Edit Company' : 'Add Company'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Company Name *
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Cadbury"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Code * (short, used in bill numbers)
            </label>
            <input
              required
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. CAD"
              maxLength={8}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-500 uppercase"
            />
            <p className="mt-1 text-xs text-slate-500">
              Bills will be numbered like BILL-{form.code || 'CODE'}-0001
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Members modal */}
      <Modal
        open={!!membersFor}
        onClose={() => {
          setMembersFor(null);
          setShowMemberForm(false);
        }}
        title={membersFor ? `Members — ${membersFor.name}` : 'Members'}
      >
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {members.length} active member{members.length === 1 ? '' : 's'}
            </p>
            <button
              onClick={() => setShowMemberForm(true)}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <UserPlus className="h-3.5 w-3.5" /> Add Member
            </button>
          </div>

          {showMemberForm && (
            <form
              onSubmit={handleCreateMember}
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3 bg-slate-50 dark:bg-slate-800"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Full Name *
                  </label>
                  <input
                    required
                    value={memberForm.name}
                    onChange={(e) =>
                      setMemberForm({ ...memberForm, name: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Role *
                  </label>
                  <select
                    value={memberForm.role}
                    onChange={(e) =>
                      setMemberForm({
                        ...memberForm,
                        role: e.target.value as MembershipRole,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="admin">Company Admin</option>
                    <option value="employee">Employee</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Email *
                  </label>
                  <input
                    required
                    type="email"
                    value={memberForm.email}
                    onChange={(e) =>
                      setMemberForm({ ...memberForm, email: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Password *
                  </label>
                  <input
                    required
                    type="password"
                    minLength={6}
                    value={memberForm.password}
                    onChange={(e) =>
                      setMemberForm({ ...memberForm, password: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowMemberForm(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={memberSubmitting}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {memberSubmitting ? 'Creating...' : 'Create Member'}
                </button>
              </div>
            </form>
          )}

          {membersLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-6">
              No members yet
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between py-2.5 gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {m.employee_name || m.email || m.user_id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={
                        m.role === 'admin'
                          ? 'rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                          : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }
                    >
                      {m.role}
                    </span>
                    <button
                      onClick={() => setRemoveMember(m)}
                      className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Delete Company"
        message={`Delete "${deleteConfirm?.name}"? This cannot be undone if the company has data.`}
        confirmLabel="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={!!removeMember}
        onClose={() => setRemoveMember(null)}
        onConfirm={handleRemoveMember}
        title="Remove Member"
        message="Remove this member from the company? They will lose access to this company's data."
        confirmLabel="Remove"
        variant="danger"
      />
    </div>
  );
}
