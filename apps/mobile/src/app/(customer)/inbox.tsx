import { NotificationList } from '@/notifications/NotificationList';

export default function Inbox() {
  return <NotificationList open={(id) => `/order/${id}`} home="/orders" />;
}
