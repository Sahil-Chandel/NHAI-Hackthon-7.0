import 'package:flutter/material.dart';
import '../../widgets/attendance_calendar.dart';
import '../../widgets/gradient_background.dart';

class AdminWorkerCalendarScreen extends StatelessWidget {
  final String? workerId;
  final String? workerName;

  const AdminWorkerCalendarScreen({super.key, this.workerId, this.workerName});

  @override
  Widget build(BuildContext context) {
    // Demo data
    final attendance = <int, AttendanceType>{};
    for (int i = 1; i <= 28; i++) {
      if (i % 7 == 0) {
        attendance[i] = AttendanceType.absent;
      } else if (i % 5 == 0) {
        attendance[i] = AttendanceType.partial;
      } else {
        attendance[i] = AttendanceType.full;
      }
    }

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F172A),
        elevation: 0,
        title: Text(workerName ?? 'Worker Attendance', style: const TextStyle(color: Colors.white)),
        leading: const BackButton(color: Colors.white),
      ),
      body: GradientBackground(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: AttendanceCalendar(attendance: attendance),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _stat('Full Days', '20', const Color(0xFF10B981)),
                    _stat('Partial', '4', const Color(0xFFF59E0B)),
                    _stat('Absent', '4', const Color(0xFFEF4444)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stat(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 12)),
      ],
    );
  }
}
