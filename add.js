const form = document.getElementById('add-form');
const notice = document.getElementById('notice');
const dateInput = form.elements.dateAdded;

// Prefill date added with today's date (local time, YYYY-MM-DD).
function today() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d - offset).toISOString().slice(0, 10);
}
dateInput.value = today();

function showNotice(message, isError) {
  notice.textContent = message;
  notice.className = isError ? 'notice notice-error' : 'notice';
  notice.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);

  const text = data.get('text').trim();
  if (!text) return;

  // Only send optional fields when they have a value.
  const quote = { text };
  const author = data.get('author').trim();
  const dateAdded = data.get('dateAdded');
  const source = data.get('source').trim();
  if (author) quote.author = author;
  if (dateAdded) quote.dateAdded = dateAdded;
  if (source) quote.source = source;

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await QuoteAPI.add(quote);
    form.reset();
    dateInput.value = today();
    showNotice('Quote added.', false);
    form.querySelector('textarea').focus();
  } catch (err) {
    showNotice('Could not save — is the server running?', true);
  } finally {
    submitBtn.disabled = false;
  }
});
