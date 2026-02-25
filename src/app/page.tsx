import { redirect } from 'next/navigation';

// Root / redirects to /neummai
// Middleware will catch unauthenticated users and send them to /login first
export default function RootPage() {
  redirect('/neummai');
}
