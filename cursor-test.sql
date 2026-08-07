DELETE FROM logs WHERE service = 'cursor-test';

INSERT INTO logs 
(timestamp, level, service, message, attributes)
SELECT 
    '2026-01-01T00:00:00Z',
    'info',
    'cursor-test',
    'same timestamp test ' || generate_series,
    '{"test":"cursor"}'
FROM generate_series(1,50);
