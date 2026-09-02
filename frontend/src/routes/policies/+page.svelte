<script lang="ts">
	import ContactModal from '$lib/components/ContactModal.svelte';

	type Faq = { q: string; a: string };
	type FaqGroup = { title: string; items: Faq[] };

	let activeTab: 'faq' | 'policies' = 'faq';
	let contactModalOpen = false;

	const faqGroups: FaqGroup[] = [
		{
			title: 'Booking & payment',
			items: [
				{
					q: 'When is my booking actually confirmed?',
					a: "Your booking only becomes official once payment goes through successfully. Before that, it's just held for you temporarily."
				},
				{
					q: "What happens if I don't pay in time?",
					a: "You have 30 minutes to finish paying. If you don't, the booking is cancelled automatically and the time slot opens back up for other people. We'll also remind you a few minutes in, in case you forgot."
				},
				{
					q: 'Will I get reminders about my booking?',
					a: "Yes. We'll nudge you to finish paying a few minutes after you start a booking, and send reminders the day before and an hour before your session. You'll also get a confirmation email with all the details once payment goes through."
				}
			]
		},
		{
			title: 'Hours, availability & plans',
			items: [
				{
					q: 'What are your operating hours?',
					a: "We're open Monday to Friday, 9:00 AM to 7:00 PM. We're closed on weekends and public holidays, so those days won't show up as available. Management may also close a room for a specific date if needed."
				},
				{
					q: 'Do you offer weekly or monthly plans?',
					a: "Yes. A weekly plan gives you 10 hours for 10% off the usual rate, and a monthly plan gives you 40 hours for 20% off. You can also book several days or weeks ahead in one go, as long as they're available. Just note you can book up to 10 hours in a single day."
				},
				{
					q: 'Is membership available?',
					a: "Not yet — it's on hold for now, but may be added down the line."
				}
			]
		},
		{
			title: 'Cancellations & rescheduling',
			items: [
				{
					q: 'Can I cancel my booking and get a refund?',
					a: "Once you've paid for a booking, it can't be refunded. We'll always show you this clearly before you pay, so there are no surprises. If something genuinely unexpected comes up, reach out to us and we'll take a look."
				},
				{
					q: 'Can I reschedule instead of cancelling?',
					a: 'Yes, just ask at least 24 hours before your booking. Your first change is free. A second change, or one with less notice, may come with a small fee (10% of the original price). One-off bookings can move to a new date within 30 days; plan bookings need to stay within your plan period.'
				},
				{
					q: 'What if my rescheduled slot costs more or less?',
					a: "If it costs more, you just pay the difference. If it costs less, we won't refund the difference in cash — it's added as credit for a future booking instead."
				}
			]
		},
		{
			title: 'No-shows & changes on our end',
			items: [
				{
					q: "What happens if I don't show up?",
					a: "If you miss a booking without cancelling or rescheduling it, you lose what you paid. If something genuine came up, get in touch and we'll take a look — it's just not automatic."
				},
				{
					q: 'What if BAI Business Hub cancels my booking, or the room becomes unavailable?',
					a: "If we ever have to cancel your booking, or your room becomes unavailable for reasons on our side (maintenance, an emergency, that sort of thing), you can choose a full refund or a free reschedule. You'll never be charged for changes we make."
				}
			]
		}
	];

	// only one FAQ item open at a time, tracked by a "group-item" key
	let openKey: string | null = 'g0-i0';
	function toggle(key: string) {
		openKey = openKey === key ? null : key;
	}

	const policySections = [
		{
			num: '01',
			title: 'Booking & payment',
			items: [
				'A booking is only confirmed once payment is completed successfully.',
				"If payment isn't completed within 30 minutes, the booking is cancelled automatically and the slot becomes available again.",
				'A reminder to finish payment appears about 2\u20135 minutes after a booking is started.',
				'Once payment succeeds, a confirmation email is sent with the booking reference, room, date, time, duration, amount paid, and relevant policies.',
				'Reminders are also sent 1 day and 1 hour before the booking.'
			]
		},
		{
			num: '02',
			title: 'Operating hours & availability',
			items: [
				'Open Monday to Friday, 9:00 AM\u20137:00 PM. Closed on weekends and public holidays.',
				'If weekend hours are introduced later, they will initially cost the same as weekday hours.',
				'Weekends, public holidays, and any dates closed by management are automatically unavailable to book.',
				'Management may also close specific rooms or dates for maintenance, private events, or other reasons.'
			]
		},
		{
			num: '03',
			title: 'Weekly & monthly plans',
			items: [
				'Weekly plan: 10 hours a week, at 10% off the regular hourly rate.',
				'Monthly plan: 40 hours a month, at 20% off the regular hourly rate.',
				"Several days or weeks can be booked at once, as long as they're available.",
				"There's no overall limit on total hours booked, but the most bookable in a single day is 10 hours."
			]
		},
		{
			num: '04',
			title: 'Membership',
			items: [
				"On hold \u2014 membership isn't currently available. This is kept for future reference only."
			]
		},
		{
			num: '05',
			title: 'Cancellations & refunds',
			items: [
				'Once a booking is paid for, it cannot be refunded.',
				'This is shown clearly before payment, and must be acknowledged before checkout.',
				'Genuine emergencies may still be reviewed by management on a case-by-case basis.',
				"There's no separate late-cancellation fee \u2014 cancelling simply means the payment isn't refunded."
			]
		},
		{
			num: '06',
			title: 'Rescheduling',
			items: [
				'Requests must be made at least 24 hours before the original booking.',
				'The first reschedule is free. A second or late request may include a 10% fee based on the original price.',
				'One-off bookings can move to a new date within 30 days of the original. Plan bookings must stay within the current plan period, or the one immediately after.',
				'A price increase means paying the difference; a price decrease is added as account credit rather than refunded in cash.'
			]
		},
		{
			num: '07',
			title: 'No-show policy',
			items: [
				"Missing a booking without cancelling or rescheduling means the full payment isn't returned.",
				"Genuine emergencies may be reviewed by management, but this isn't automatic."
			]
		},
		{
			num: '08',
			title: 'Cancellations & closures on our end',
			items: [
				'If a paid booking is cancelled by us, or a room becomes unavailable due to maintenance, an emergency, or another issue on our side, the customer can choose a full refund or a free reschedule.',
				'Changes made on our end never come with a fee for the customer.'
			]
		}
	];
</script>

<svelte:head>
	<title>FAQs & Policies | BAI Business Hub</title>
</svelte:head>

<div class="bg-primary-50/40">
	<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
		<div class="max-w-2xl">
			<h1 class="text-3xl sm:text-4xl font-bold text-primary-950 mb-3">FAQs & Policies</h1>
			<p class="text-primary-700 leading-relaxed">
				Everything you need to know about booking, paying, rescheduling, and cancelling at BAI
				Business Hub. Browse quick answers below, or check the full policy reference.
			</p>
		</div>

		<!-- Segmented toggle -->
		<div class="mt-8 inline-flex p-1 bg-primary-100 rounded-lg">
			<button
				class="px-4 py-2 rounded-md text-sm font-medium transition-colors {activeTab === 'faq'
					? 'bg-white text-primary-900 shadow-sm'
					: 'text-primary-600 hover:text-primary-900'}"
				on:click={() => (activeTab = 'faq')}
			>
				Quick answers
			</button>
			<button
				class="px-4 py-2 rounded-md text-sm font-medium transition-colors {activeTab ===
				'policies'
					? 'bg-white text-primary-900 shadow-sm'
					: 'text-primary-600 hover:text-primary-900'}"
				on:click={() => (activeTab = 'policies')}
			>
				Full policy reference
			</button>
		</div>
	</div>
</div>

<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
	{#if activeTab === 'faq'}
		<div class="space-y-10">
			{#each faqGroups as group, gi}
				<div>
					<h2 class="text-sm font-semibold text-primary-900 uppercase tracking-wide mb-3">
						{group.title}
					</h2>
					<div
						class="rounded-xl border border-primary-100 divide-y divide-primary-100 overflow-hidden bg-white"
					>
						{#each group.items as faq, ii}
							{@const key = `g${gi}-i${ii}`}
							<div>
								<button
									class="w-full flex items-center justify-between gap-4 text-left px-5 py-4 hover:bg-primary-50/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
									on:click={() => toggle(key)}
									aria-expanded={openKey === key}
								>
									<span class="font-medium text-primary-900 text-[15px]">{faq.q}</span>
									<svg
										class="w-4 h-4 text-primary-400 shrink-0 transition-transform duration-200 {openKey ===
										key
											? 'rotate-180'
											: ''}"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</button>
								{#if openKey === key}
									<div class="px-5 pb-4 text-sm text-primary-700 leading-relaxed">
										{faq.a}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="space-y-6">
			{#each policySections as section}
				<div class="rounded-xl border border-primary-100 bg-white p-6 sm:p-7">
					<div class="flex items-start gap-4">
						<span
							class="shrink-0 w-9 h-9 rounded-lg bg-primary-600 text-white text-xs font-semibold flex items-center justify-center"
						>
							{section.num}
						</span>
						<div class="flex-1 min-w-0">
							<h2 class="text-base font-semibold text-primary-950 mb-3 pt-1.5">
								{section.title}
							</h2>
							<ul class="space-y-2">
								{#each section.items as item}
									<li class="flex gap-2.5 text-sm text-primary-700 leading-relaxed">
										<span class="text-gold-500 mt-1.5 shrink-0">&bull;</span>
										<span>{item}</span>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<p class="text-xs text-primary-400 mt-8">
			This reflects our current policies. For anything not covered here, contact us below.
		</p>
	{/if}

	<div
		class="mt-14 rounded-xl bg-primary-950 px-6 py-8 sm:px-10 sm:py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
	>
		<div>
			<h3 class="text-white font-semibold text-lg mb-1">Still have questions?</h3>
			<p class="text-primary-200 text-sm">We're happy to help with anything not covered here.</p>
		</div>
		<button
			on:click={() => (contactModalOpen = true)}
			class="inline-flex items-center justify-center bg-white text-primary-900 hover:bg-primary-50 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shrink-0"
		>
			Contact us
		</button>
	</div>
</div>

<ContactModal bind:open={contactModalOpen} />