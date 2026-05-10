import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';

// Custom counter to track failed requests
const errors = new Counter('errors');

// Test configuration
export const options = {
  vus: 200,          // 200 virtual users running simultaneously
  duration: '5m',    // run for 5 minutes
};

export default function () {
  // Replace this IP after you deploy and get your external IP
  // kubectl get svc -n webapp → copy the EXTERNAL-IP value
  const BASE_URL = 'http://YOUR_EXTERNAL_IP_HERE';

  // Hit the homepage
  const res = http.get(BASE_URL + '/');

  // Check the response was successful
  const success = check(res, {
    'status is 200':        (r) => r.status === 200,
    'response time < 2s':   (r) => r.timings.duration < 2000,
  });

  // Count failures
  if (!success) {
    errors.add(1);
  }

  sleep(1); // each VU waits 1 second between requests
}