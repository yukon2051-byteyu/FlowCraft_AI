import { Navigate, Route, Routes, useLocation } from 'react-router'
import DiagnosticsPage from './pages/DiagnosticsPage'
import KaizenDemoPage from './pages/KaizenDemoPage'
import NotFoundPage from './pages/NotFoundPage'
import TopPage from './pages/TopPage'
import WorkspacePage from './pages/WorkspacePage'

/** 画面の一覧（URL と表示する画面の対応表）。 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TopPage />} />
      {/* 作る画面（回す画面 /run は Phase 4 で追加）。旧URL /workspace は /build へ転送する */}
      <Route path="/build" element={<WorkspacePage />} />
      <Route path="/workspace" element={<RedirectKeepingQuery to="/build" />} />
      {/* 業務改善診断デモ（デモ①「その集計、本当に必要？」） */}
      <Route path="/kaizen-demo" element={<KaizenDemoPage />} />
      <Route path="/dev/diagnostics" element={<DiagnosticsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

/** URLの後ろの指定（?view=sample など）を引き継いで転送する */
function RedirectKeepingQuery({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}
