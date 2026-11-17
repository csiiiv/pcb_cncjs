// Spotlight a widget: scroll its dock slot into view and flash its border.
// In Guided mode dock slots don't exist — fall back to the matching subway
// station, which opens the stage panel via its own click handler.
export function focusWidget(id) {
  const slot = document.querySelector(`.widget-slot[data-widget="${id}"]`);
  if (slot) {
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    slot.classList.remove('flash');
    void slot.offsetWidth; // restart the animation
    slot.classList.add('flash');
    setTimeout(() => slot.classList.remove('flash'), 1600);
    return true;
  }
  const station = document.querySelector(`.subway-station[data-widget="${id}"]`);
  if (station) {
    station.click();
    station.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return true;
  }
  const testEntry = document.querySelector(`.test-entry[data-widget="${id}"]`);
  if (testEntry) {
    testEntry.click();
    return true;
  }
  return false;
}
