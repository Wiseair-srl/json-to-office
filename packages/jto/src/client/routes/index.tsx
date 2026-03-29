import { lazy, Suspense } from 'react';
import { RouteObject } from 'react-router-dom';
import { RootLayout } from '@/layouts/RootLayout';
import { Spinner } from '@/components/ui/spinner';

// Lazy load all pages for code splitting
const HomePage = lazy(() =>
  import('@/pages/HomePage').then((module) => ({ default: module.HomePage }))
);
const JsonEditorPage = lazy(() =>
  import('@/pages/JsonEditorPage').then((module) => ({
    default: module.JsonEditorPage,
  }))
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({
    default: module.NotFoundPage,
  }))
);

// Loading component for lazy loaded routes
const LazyLoadWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense
    fallback={
      <div className="flex items-center justify-center h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    }
  >
    {children}
  </Suspense>
);

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: (
          <LazyLoadWrapper>
            <HomePage />
          </LazyLoadWrapper>
        ),
      },
      {
        path: 'json-editor',
        element: (
          <LazyLoadWrapper>
            <JsonEditorPage />
          </LazyLoadWrapper>
        ),
      },
    ],
  },
  {
    path: '*',
    element: (
      <LazyLoadWrapper>
        <NotFoundPage />
      </LazyLoadWrapper>
    ),
  },
];
