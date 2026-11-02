// Notification permission is requested by a user action, never by an incoming message. AGPL-3.0-only.
export function canUseSystemNotifications(): boolean {
    return 'Notification' in window && window.isSecureContext
}

export function readNotificationPermission(): NotificationPermission | 'unsupported' {
    return canUseSystemNotifications() ? Notification.permission : 'unsupported'
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!canUseSystemNotifications()) return 'unsupported'
    return Notification.requestPermission()
}
