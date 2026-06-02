String formatDuration(Duration d) {
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  if (h > 0) return '${h}h ${m}m';
  return '${m}m';
}

String formatTimeOfDay(DateTime dt) {
  final h = dt.hour.toString().padLeft(2, '0');
  final m = dt.minute.toString().padLeft(2, '0');
  final s = dt.second.toString().padLeft(2, '0');
  return '$h:$m:$s';
}

Duration? calculateWorkHours(DateTime? punchIn, DateTime? punchOut) {
  if (punchIn == null || punchOut == null) return null;
  return punchOut.difference(punchIn);
}

bool isFullDay(Duration? workHours) {
  if (workHours == null) return false;
  return workHours.inHours >= 8;
}

bool isPartialDay(Duration? workHours) {
  if (workHours == null) return false;
  return workHours.inHours >= 4 && workHours.inHours < 8;
}

String greetingByTime() {
  final h = DateTime.now().hour;
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}
