import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/AuditPage'
import { ConfirmDeliveryPage } from './pages/ConfirmDeliveryPage'
import { EvidencePage } from './pages/EvidencePage'
import { LandingPage } from './pages/LandingPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { MyInvoicesPage } from './pages/MyInvoicesPage'
import { NewInvoicePage } from './pages/NewInvoicePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ReviewInvoicePage } from './pages/ReviewInvoicePage'
import { ReviewQueuePage } from './pages/ReviewQueuePage'
import { ProjectsPage } from './pages/ProjectsPage'

export const routes: RouteObject[] = [
  // Public landing page: its own full-width layout and nav.
  { index: true, element: <LandingPage /> },
  {
    element: <Layout />,
    children: [
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'supplier/invoices', element: <MyInvoicesPage /> },
      { path: 'supplier/invoices/new', element: <NewInvoicePage /> },
      { path: 'review', element: <ReviewQueuePage /> },
      { path: 'review/:id', element: <ReviewInvoicePage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'delivery/:milestoneId/evidence', element: <EvidencePage /> },
      { path: 'delivery/:milestoneId/confirm', element: <ConfirmDeliveryPage /> },
      // Pages 2–9 get added here as we build them.
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
