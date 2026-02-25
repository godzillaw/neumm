import { redirect } from 'next/navigation';
// Old route — redirect permanently to /signup
export default function OldSignupPage() {
  redirect('/signup');
}
