import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '../components/theme-provider';
import { TooltipProvider } from '../components/ui/tooltip';
import { Toaster } from '../components/ui/toaster';

export function RootLayout() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <TooltipProvider delayDuration={300}>
        <div className="min-h-screen bg-background font-sans antialiased">
          <Outlet />
        </div>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
