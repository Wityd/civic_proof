import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ViewAsProvider } from './context/ViewAsContext'
import './index.css'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ViewAsProvider>
        <RouterProvider router={router} />
      </ViewAsProvider>
    </QueryClientProvider>
  </StrictMode>,
)
