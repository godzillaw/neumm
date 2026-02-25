import { redirect } from 'next/navigation';
// Old route — redirect permanently to /login
export default function OldLoginPage() {
  redirect('/login');
}
