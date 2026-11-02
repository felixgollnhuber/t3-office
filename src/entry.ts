import { resumeArrival } from './elevator';
/** The original office is the home screen. Friends and customization are optional menu content. */
const params = new URLSearchParams(location.search);
if (params.get('view') === 'friends') {
  void import('./building');
} else {
  resumeArrival();
  void import('./main');
}
