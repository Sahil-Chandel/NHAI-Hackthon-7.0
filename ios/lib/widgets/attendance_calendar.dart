import 'package:flutter/material.dart';

enum AttendanceType { full, partial, absent, none }

class AttendanceCalendar extends StatefulWidget {
  final Map<int, AttendanceType> attendance;
  final void Function(DateTime)? onDateTap;

  const AttendanceCalendar({super.key, required this.attendance, this.onDateTap});

  @override
  State<AttendanceCalendar> createState() => _AttendanceCalendarState();
}

class _AttendanceCalendarState extends State<AttendanceCalendar> {
  late DateTime _current;

  @override
  void initState() {
    super.initState();
    _current = DateTime.now();
  }

  @override
  Widget build(BuildContext context) {
    final year = _current.year;
    final month = _current.month;
    final daysInMonth = DateTime(year, month + 1, 0).day;
    final firstWeekday = DateTime(year, month, 1).weekday % 7;
    final today = DateTime.now();

    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            IconButton(
              icon: const Icon(Icons.chevron_left, color: Colors.white),
              onPressed: () => setState(() => _current = DateTime(year, month - 1)),
            ),
            Text(
              '${_monthName(month)} $year',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
            ),
            IconButton(
              icon: const Icon(Icons.chevron_right, color: Colors.white),
              onPressed: () => setState(() => _current = DateTime(year, month + 1)),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: ['S', 'M', 'T', 'W', 'T', 'F', 'S']
              .map((d) => Expanded(
                    child: Center(
                      child: Text(d, style: const TextStyle(color: Colors.white54, fontSize: 12, fontWeight: FontWeight.w600)),
                    ),
                  ))
              .toList(),
        ),
        const SizedBox(height: 4),
        ...List.generate(6, (week) {
          return Row(
            children: List.generate(7, (dow) {
              final dayIndex = week * 7 + dow - firstWeekday + 1;
              if (dayIndex < 1 || dayIndex > daysInMonth) {
                return const Expanded(child: SizedBox(height: 40));
              }
              final isFuture = DateTime(year, month, dayIndex).isAfter(today);
              final type = isFuture ? AttendanceType.none : (widget.attendance[dayIndex] ?? AttendanceType.none);
              return Expanded(
                child: GestureDetector(
                  onTap: () => widget.onDateTap?.call(DateTime(year, month, dayIndex)),
                  child: Container(
                    height: 40,
                    margin: const EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      color: _colorForType(type),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Center(
                      child: Text(
                        '$dayIndex',
                        style: TextStyle(
                          color: type == AttendanceType.none ? Colors.white38 : Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ),
                ),
              );
            }),
          );
        }),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _legend(const Color(0xFF10B981), 'Full day'),
            const SizedBox(width: 16),
            _legend(const Color(0xFFF59E0B), 'Partial'),
            const SizedBox(width: 16),
            _legend(const Color(0xFFEF4444), 'Absent'),
          ],
        ),
      ],
    );
  }

  Color _colorForType(AttendanceType type) {
    switch (type) {
      case AttendanceType.full:
        return const Color(0xFF10B981).withValues(alpha: 0.3);
      case AttendanceType.partial:
        return const Color(0xFFF59E0B).withValues(alpha: 0.3);
      case AttendanceType.absent:
        return const Color(0xFFEF4444).withValues(alpha: 0.3);
      case AttendanceType.none:
        return Colors.transparent;
    }
  }

  Widget _legend(Color color, String label) {
    return Row(
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 11)),
      ],
    );
  }

  String _monthName(int m) {
    const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[m];
  }
}
