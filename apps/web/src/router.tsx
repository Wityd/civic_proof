import { createBrowserRouter } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/AuditPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { MyInvoicesPage } from './pages/MyInvoicesPage'
import { NewInvoicePage } from './pages/NewInvoicePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ReviewInvoicePage } from './pages/ReviewInvoicePage'
import { ReviewQueuePage } from './pages/ReviewQueuePage'
import { ProjectsPage } from './pages/ProjectsPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'supplier/invoices', element: <MyInvoicesPage /> },
      { path: 'supplier/invoices/new', element: <NewInvoicePage /> },
      { path: 'review', element: <ReviewQueuePage /> },
      { path: 'review/:id', element: <ReviewInvoicePage /> },
      { path: 'audit', element: <AuditPage /> },
      // Pages 2–9 get added here as we build them.
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
])
