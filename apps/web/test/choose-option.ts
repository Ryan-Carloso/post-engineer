import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export async function chooseOption(field: string | HTMLElement, optionName: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(typeof field === 'string' ? screen.getByLabelText(field) : field);
  await user.click(screen.getByRole('option', { name: optionName }));
}
