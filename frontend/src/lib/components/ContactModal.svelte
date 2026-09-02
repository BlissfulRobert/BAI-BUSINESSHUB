<script lang="ts">
	export let open = false;

	let name = '';
	let email = '';
	let message = '';

	type Status = 'idle' | 'submitting' | 'success' | 'error';
	let status: Status = 'idle';
	let errorMessage = '';

	function close() {
		open = false;
		// reset after the close animation would run, so the form is fresh next time
		setTimeout(() => {
			status = 'idle';
			errorMessage = '';
			name = '';
			email = '';
			message = '';
		}, 200);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	async function handleSubmit() {
		errorMessage = '';

		if (!name.trim() || !email.trim() || !message.trim()) {
			errorMessage = 'Please fill in all fields.';
			return;
		}

		status = 'submitting';

		try {
			const res = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, message })
			});

			const data = await res.json();

			if (!res.ok) {
				status = 'error';
				errorMessage = data?.error || 'Something went wrong. Please try again.';
				return;
			}

			status = 'success';
		} catch (err) {
			status = 'error';
			errorMessage = 'Something went wrong. Please try again.';
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-primary-950/50 backdrop-blur-sm px-4"
		on:click={handleBackdropClick}
		role="presentation"
	>
		<div
			class="w-full max-w-md bg-white rounded-xl shadow-xl p-6 sm:p-7"
			role="dialog"
			aria-modal="true"
			aria-labelledby="contact-modal-title"
		>
			{#if status === 'success'}
				<div class="text-center py-4">
					<div
						class="mx-auto w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-4"
					>
						<svg
							class="w-6 h-6 text-primary-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							/>
						</svg>
					</div>
					<h2 class="text-lg font-semibold text-primary-950 mb-1">Message sent</h2>
					<p class="text-sm text-primary-600 mb-6">
						Thanks for reaching out — we'll get back to you soon.
					</p>
					<button
						on:click={close}
						class="w-full bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
					>
						Close
					</button>
				</div>
			{:else}
				<div class="flex items-start justify-between mb-1">
					<h2 id="contact-modal-title" class="text-lg font-semibold text-primary-950">
						Get in touch
					</h2>
					<button
						on:click={close}
						aria-label="Close"
						class="text-primary-400 hover:text-primary-700 transition-colors p-1 -m-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
				<p class="text-sm text-primary-600 mb-5">
					Send us a message and we'll reply to your email directly.
				</p>

				<form
					class="space-y-4"
					on:submit|preventDefault={handleSubmit}
				>
					<div>
						<label for="contact-name" class="block text-sm font-medium text-primary-800 mb-1.5">
							Name
						</label>
						<input
							id="contact-name"
							type="text"
							bind:value={name}
							disabled={status === 'submitting'}
							class="w-full rounded-lg border border-primary-200 px-3.5 py-2.5 text-sm text-primary-900 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-60"
							placeholder="Your name"
						/>
					</div>

					<div>
						<label for="contact-email" class="block text-sm font-medium text-primary-800 mb-1.5">
							Email
						</label>
						<input
							id="contact-email"
							type="email"
							bind:value={email}
							disabled={status === 'submitting'}
							class="w-full rounded-lg border border-primary-200 px-3.5 py-2.5 text-sm text-primary-900 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-60"
							placeholder="you@example.com"
						/>
					</div>

					<div>
						<label
							for="contact-message"
							class="block text-sm font-medium text-primary-800 mb-1.5"
						>
							Message
						</label>
						<textarea
							id="contact-message"
							bind:value={message}
							disabled={status === 'submitting'}
							rows="4"
							class="w-full rounded-lg border border-primary-200 px-3.5 py-2.5 text-sm text-primary-900 placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-60 resize-none"
							placeholder="How can we help?"
						></textarea>
					</div>

					{#if errorMessage}
						<p class="text-sm text-red-600">{errorMessage}</p>
					{/if}

					<button
						type="submit"
						disabled={status === 'submitting'}
						class="w-full bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
					>
						{status === 'submitting' ? 'Sending...' : 'Send message'}
					</button>
				</form>
			{/if}
		</div>
	</div>
{/if}