import { apiRequest } from './client'

/*
 * ひな形（新ワークフロー Phase 2。backend/app/api/demos.py の /api/templates）。
 * デモの作業手順を、作業起点の「仮の手順」のもとにする。ファイルは読み込まない。
 */

export type TemplateSummary = { template_id: string; title: string; summary: string; inputs: string[] }

export function listTemplates(): Promise<TemplateSummary[]> {
  return apiRequest<TemplateSummary[]>('/api/templates')
}

export function fetchTemplate(id: string): Promise<unknown> {
  return apiRequest<unknown>(`/api/templates/${encodeURIComponent(id)}`)
}
