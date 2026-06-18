import { Route, Routes } from "react-router-dom";
import { StoreProvider, useStats } from "./lib/store";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Live from "./pages/Live";
import Events from "./pages/Events";
import Sessions from "./pages/Sessions";
import Pages from "./pages/Pages";
import MapPage from "./pages/MapPage";
import Funnels from "./pages/Funnels";
import Journeys from "./pages/Journeys";
import Retention from "./pages/Retention";
import Goals from "./pages/Goals";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Bmm from "./pages/Bmm";
import Admin from "./pages/Admin";

function Gate({ children }: { children: React.ReactNode }) {
  const stats = useStats();
  if (!stats) {
    return (
      <div className="h-full flex items-center justify-center text-sub">
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          Connecting to telemetry stream…
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <StoreProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Gate><Overview /></Gate>} />
          <Route path="live" element={<Gate><Live /></Gate>} />
          <Route path="events" element={<Gate><Events /></Gate>} />
          <Route path="sessions" element={<Gate><Sessions /></Gate>} />
          <Route path="pages" element={<Gate><Pages /></Gate>} />
          <Route path="map" element={<Gate><MapPage /></Gate>} />
          <Route path="funnels" element={<Gate><Funnels /></Gate>} />
          <Route path="journeys" element={<Gate><Journeys /></Gate>} />
          <Route path="retention" element={<Gate><Retention /></Gate>} />
          <Route path="goals" element={<Gate><Goals /></Gate>} />
          <Route path="users" element={<Gate><Users /></Gate>} />
          <Route path="users/:id" element={<Gate><UserDetail /></Gate>} />
          <Route path="bmm" element={<Gate><Bmm /></Gate>} />
          <Route path="admin" element={<Gate><Admin /></Gate>} />
        </Route>
      </Routes>
    </StoreProvider>
  );
}
