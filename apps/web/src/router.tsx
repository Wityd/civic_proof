import { createBrowserRouter } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { MyInvoicesPage } from './pages/MyInvoicesPage'
import { NewInvoicePage } from './pages/NewInvoicePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectsPage } from './pages/ProjectsPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'supplier/invoices', element: <MyInvoicesPage /> },
      { path: 'supplier/invoices/new', element: <NewInvoicePage /> },
      // Pages 2–9 get added here as we build them.
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
])
