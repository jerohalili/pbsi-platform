import { AvatarSection } from '@/components/settings/AvatarSection.tsx';
import { ProfileSection } from '@/components/settings/ProfileSection.tsx';
import { PasswordSection } from '@/components/settings/PasswordSection.tsx';

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div data-tour="st-header">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile picture, personal details and password.</p>
      </div>
      <AvatarSection />
      <ProfileSection />
      <PasswordSection />
    </div>
  );
}
