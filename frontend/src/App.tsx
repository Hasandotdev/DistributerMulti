import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useCompany } from './contexts/CompanyContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import BillsPage from './pages/BillsPage'
import RecoveriesPage from './pages/RecoveriesPage'
import CustomersPage from './pages/CustomersPage'
import RoutesPage from './pages/RoutesPage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import PrintPage from './pages/PrintPage'
import CompaniesPage from './pages/CompaniesPage'

function FullSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return <FullSpinner />
  if (!user) return <Navigate to="/login" replace />

  return <>{children}</>
}

function RoleRoute({
  roles,
  children,
}: {
  roles: Array<'super_admin' | 'admin' | 'employee'>
  children: React.ReactNode
}) {
  const { userRole, loading } = useAuth()
  if (loading) return <FullSpinner />
  if (!userRole || !roles.includes(userRole)) {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

function CompanyGate({ children }: { children: React.ReactNode }) {
  const { userRole } = useAuth()
  const { activeCompany, companies, loading } = useCompany()

  if (loading) return <FullSpinner />

  if (userRole === 'super_admin') {
    if (companies.length === 0) {
      return <Navigate to="/companies" replace />
    }
    if (!activeCompany) {
      return <Navigate to="/companies" replace />
    }
    return <>{children}</>
  }

  if (!activeCompany) {
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          No company assigned
        </h2>
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
          Your account is not linked to any company yet. Ask your
          administrator to assign you to a company.
        </p>
      </div>
    )
  }

  return <>{children}</>
}

function App() {
  const { user, loading } = useAuth()

  if (loading) return <FullSpinner />

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <CompanyGate>
              <Dashboard />
            </CompanyGate>
          }
        />
        <Route
          path="bills"
          element={
            <CompanyGate>
              <BillsPage />
            </CompanyGate>
          }
        />
        <Route
          path="recoveries"
          element={
            <CompanyGate>
              <RecoveriesPage />
            </CompanyGate>
          }
        />
        <Route
          path="customers"
          element={
            <CompanyGate>
              <CustomersPage />
            </CompanyGate>
          }
        />
        <Route
          path="routes"
          element={
            <CompanyGate>
              <RoutesPage />
            </CompanyGate>
          }
        />
        <Route
          path="employees"
          element={
            <RoleRoute roles={['super_admin', 'admin']}>
              <CompanyGate>
                <EmployeesPage />
              </CompanyGate>
            </RoleRoute>
          }
        />
        <Route
          path="reports"
          element={
            <CompanyGate>
              <ReportsPage />
            </CompanyGate>
          }
        />
        <Route
          path="print"
          element={
            <CompanyGate>
              <PrintPage />
            </CompanyGate>
          }
        />
        <Route
          path="companies"
          element={
            <RoleRoute roles={['super_admin']}>
              <CompaniesPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
