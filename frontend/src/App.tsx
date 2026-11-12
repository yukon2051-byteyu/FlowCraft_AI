import { Route, Routes } from 'react-router'
import DiagnosticsPage from './pages/DiagnosticsPage'
import NotFoundPage from './pages/NotFoundPage'
import TopPage from './pages/TopPage'
import WorkspacePage from './pages/WorkspacePage'

/** 画面の一覧（URL と表示する画面の対応表）。 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TopPage />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="/dev/diagnostics" element={<DiagnosticsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
