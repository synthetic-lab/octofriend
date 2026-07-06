declare module "toasted-notifier" {
	export type Notification = {
		title?: string;
		message?: string;
		[key: string]: unknown;
	};

	export type NotificationCallback = (
		error?: unknown,
		response?: unknown,
		metadata?: unknown,
	) => void;

	const notifier: {
		notify(
			notification: Notification,
			callback?: NotificationCallback,
		): unknown;
	};

	export default notifier;
}
