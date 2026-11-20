import { mockRequest } from '../mocks'
import type { ApiResponse } from '../types'

// Mocks are on when VITE_USE_MOCKS=true. They return the same shapes as the real API.
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'
const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

let authToken: string | null = null
export function setAuthToken(token: string | null) {
  authToken = token
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let status: number
  let json: ApiResponse<T>

  if (USE_MOCKS) {
    const res = await mockRequest(method, path, body)
    status = res.status
    json = res.body as ApiResponse<T>
  } else {
    const headers: Record<string, string> = {}
    if (authToken) headers.Authorization = `Bearer ${authToken}`
    const init: RequestInit = { method, headers }
    if (body instanceof FormData) {
      init.body = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    let res: Response
    try {
      res = await fetch(BASE_URL + path, init)
    } catch {
      throw new ApiError('NETWORK_ERROR', 'Could not reach the CivicProof API.', 0)
    }
    status = res.status
    json = await res.json().catch(() => ({
      error: { code: 'BAD_RESPONSE', message: `Unexpected response from the API (${res.status}).` },
    }))
  }

  if ('error' in json) throw new ApiError(json.error.code, json.error.message, status)
  return json.data
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
}
