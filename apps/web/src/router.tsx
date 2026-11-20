import { createBrowserRouter } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { ProjectsPage } from './pages/ProjectsPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ProjectsPage /> },
      // Pages 2–9 get added here as we build them.
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
])
