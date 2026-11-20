import { createBrowserRouter } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { ShellCheckPage } from './pages/ShellCheckPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ShellCheckPage /> },
      // Pages 2–9 get added here as we build them.
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
])
