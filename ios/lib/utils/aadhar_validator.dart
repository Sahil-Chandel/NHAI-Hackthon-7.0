String normalizeAadhar(String input) {
  return input.replaceAll(RegExp(r'\D'), '');
}

String formatAadharGrouped(String input) {
  final digits = normalizeAadhar(input);
  final buf = StringBuffer();
  for (int i = 0; i < digits.length && i < 12; i++) {
    if (i > 0 && i % 4 == 0) buf.write(' ');
    buf.write(digits[i]);
  }
  return buf.toString();
}

bool isValidAadhar(String input) {
  final digits = normalizeAadhar(input);
  if (digits.length != 12) return false;
  if (digits[0] == '0' || digits[0] == '1') return false;
  return _verhoeffCheck(digits);
}

String normalizeMobile(String input) {
  return input.replaceAll(RegExp(r'\D'), '');
}

bool isValidIndianMobile(String input) {
  final digits = normalizeMobile(input);
  if (digits.length != 10) return false;
  return RegExp(r'^[6-9]').hasMatch(digits);
}

// Verhoeff checksum
final _d = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

final _p = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

bool _verhoeffCheck(String num) {
  int c = 0;
  final digits = num.split('').reversed.map(int.parse).toList();
  for (int i = 0; i < digits.length; i++) {
    c = _d[c][_p[i % 8][digits[i]]];
  }
  return c == 0;
}
