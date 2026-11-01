'use server';

/**
 * Next.js Server Action demonstrating Unit III (APIs, Server Actions, Data Mutation)
 * Runs strictly on the server; validates user input and returns server execution results.
 */
export async function submitFeedback(prevState, formData) {
  const name = formData.get('name')?.toString().trim();
  const email = formData.get('email')?.toString().trim();
  const feedback = formData.get('feedback')?.toString().trim();

  if (!name || name.length < 2) {
    return { success: false, error: 'Name must be at least 2 characters long.' };
  }

  if (!email || !email.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  if (!feedback || feedback.length < 5) {
    return { success: false, error: 'Feedback message must be at least 5 characters long.' };
  }

  // NOTE: this demo form validates on the server but does not store or send anything.
  // Wire it to a database or email service before using it for real feedback.

  return {
    success: true,
    message: `Thank you, ${name}! Your message passed server-side validation. (This demo form does not store or send feedback.)`
  };
}
