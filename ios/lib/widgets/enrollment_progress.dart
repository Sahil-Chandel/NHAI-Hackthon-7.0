import 'package:flutter/material.dart';

class EnrollmentProgress extends StatelessWidget {
  final int currentStep;
  final int totalSteps;
  final List<String> labels;

  const EnrollmentProgress({
    super.key,
    required this.currentStep,
    this.totalSteps = 3,
    this.labels = const ['Frontal', 'Left', 'Right'],
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          'Step $currentStep of $totalSteps',
          style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(totalSteps, (i) {
            final isActive = i < currentStep;
            final isCurrent = i == currentStep - 1;
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 6),
              child: Column(
                children: [
                  Container(
                    width: isCurrent ? 16 : 12,
                    height: isCurrent ? 16 : 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isActive ? const Color(0xFF3B82F6) : Colors.white24,
                      border: isCurrent ? Border.all(color: Colors.white, width: 2) : null,
                    ),
                    child: isActive ? const Icon(Icons.check, size: 10, color: Colors.white) : null,
                  ),
                  const SizedBox(height: 4),
                  if (i < labels.length)
                    Text(labels[i], style: TextStyle(color: isActive ? Colors.white : Colors.white38, fontSize: 10)),
                ],
              ),
            );
          }),
        ),
      ],
    );
  }
}
