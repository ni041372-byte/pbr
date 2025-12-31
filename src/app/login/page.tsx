// src/app/login/page.tsx
import LoginForm from './login-form';

export default function LoginPage() {
  return (
    <div style={{ maxWidth: '400px', margin: '50px auto' }}>
      <h1>CMS Login</h1>
      <LoginForm />
    </div>
  );
}
