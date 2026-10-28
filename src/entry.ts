/** Keep the building lightweight; load the 3D engine only when entering an office. */
const params = new URLSearchParams(location.search);
if (params.has('source')) {
  void import('./main');
} else {
  void import('./building');
}
