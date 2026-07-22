import { BrowserRouter, Outlet, Route, Routes } from 'react-router'
import { TabBar } from './components/TabBar'
import { CameraScreen } from './screens/CameraScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { ResultScreen } from './screens/ResultScreen'

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

export default function App() {
  return (
    <BrowserRouter>
      {/* 뷰포트에 고정한다(min-h 아님) — 그래야 목록이 안에서 스크롤되고 탭바가 하단에 붙는다. */}
      <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden">
        <Routes>
          <Route element={<TabLayout />}>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/result" element={<ResultScreen />} />
          </Route>
          <Route path="/camera" element={<CameraScreen />} />
          <Route path="/loading" element={<LoadingScreen />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
