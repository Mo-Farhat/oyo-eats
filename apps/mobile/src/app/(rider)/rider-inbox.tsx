import { NotificationList } from '@/notifications/NotificationList';

/** NOT-06 for this face. */
export default function Inbox() {
  return <NotificationList open={(id) => `/job/${id}`} home="/rider" />;
}
