import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { TabBar } from './components/TabBar'
import { CameraScreen } from './screens/CameraScreen'
import { ChatScreen } from './screens/ChatScreen'
import { DoneScreen } from './screens/DoneScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { OrderScreen } from './screens/OrderScreen'
import { ResultScreen } from './screens/ResultScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useProfile } from './store/profile'

/** 탭바가 있는 화면들. 카메라·로딩은 몰입 모드라 탭바 없이 전체를 쓴다(목업과 동일). */
function TabLayout() {
  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
      <TabBar />
    </>
  )
}

/** 첫 실행이면 온보딩부터. 건너뛰어도 onboarded 로 표시되므로 두 번 묻지 않는다. */
function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const onboarded = useProfile((s) => s.onboarded)
  return onboarded ? children : <Navigate to="/onboarding" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      {/* 뷰포트에 고정한다(min-h 아님) — 그래야 목록이 안에서 스크롤되고 탭바가 하단에 붙는다. */}
      <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden">
        <Routes>
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route element={<TabLayout />}>
            <Route path="/" element={<RequireOnboarding><HomeScreen /></RequireOnboarding>} />
            <Route path="/result" element={<ResultScreen />} />
            <Route path="/order" element={<OrderScreen />} />
            <Route path="/chat" element={<ChatScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Route>
          <Route path="/camera" element={<CameraScreen />} />
          <Route path="/loading" element={<LoadingScreen />} />
          <Route path="/done" element={<DoneScreen />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
